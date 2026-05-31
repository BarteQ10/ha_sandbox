"""
MPC charge optimizer (4.2): rolling-horizon battery scheduling.

MPCScheduler.solve() takes the current SoC and a 24-hour forecast from
ForecastEngine and returns an MPCResult with:
  - schedule: list[int] — recommended action per hour (MODE_AUTO/CHARGE/DISCHARGE)
  - cost_estimate: projected grid-import cost (PLN) with MPC
  - naive_cost: projected cost without MPC (pure auto mode)
  - savings: naive_cost - cost_estimate

Algorithm (greedy local search, O(n²)):
  1. Simulate auto-mode SoC trajectory and baseline import cost.
  2. Rank hours by import price descending → discharge candidates.
  3. Rank hours by import price ascending → charge candidates.
  4. Iteratively: try discharging at the most expensive hour (if SoC allows),
     and pre-charging at the cheapest available earlier hour.
  5. Accept each move that improves total cost.  Re-simulate after each move.
"""

import logging
from dataclasses import dataclass

import numpy as np

from ems_simulator.battery import MODE_AUTO, MODE_FORCE_CHARGE, MODE_FORCE_DISCHARGE
from ems_simulator.config import BATTERY_KWH

log = logging.getLogger(__name__)

CHARGE_KW = 5.0       # max grid charge rate
DISCHARGE_KW = 5.0    # max battery discharge rate
EFFICIENCY = 0.92     # round-trip: applies on charge IN and discharge OUT
SOC_MAX = 90.0        # upper SoC target (%)
SOC_MIN = 20.0        # lower SoC guard (%)
PRICE_SCALE = 100.0 * 1000.0  # gr/kWh → PLN/Wh conversion denominator


@dataclass
class MPCResult:
    schedule: list[int]          # one MODE_* per hour, length 24
    cost_estimate: float         # projected cost with MPC (PLN)
    naive_cost: float            # projected cost without MPC (PLN)
    savings: float               # naive_cost - cost_estimate (PLN)
    current_action: int = MODE_AUTO  # recommended action for the current hour


def _simulate(soc0, pv_w, load_w, price_gr, schedule, bat_kwh=BATTERY_KWH):
    """Forward-simulate SoC and grid-import cost for a given 24-h schedule.

    Returns (soc_trajectory: list[float], total_cost: float).
    """
    n = len(schedule)
    soc = float(soc0)
    soc_traj = []
    total_cost = 0.0

    for h in range(n):
        balance_w = float(pv_w[h]) - float(load_w[h])
        action = schedule[h]
        price = float(price_gr[h])

        if action == MODE_FORCE_CHARGE:
            # Charge at CHARGE_KW from grid (in addition to PV surplus).
            # Grid import = load + charge_kw - pv (if positive).
            bat_in_kwh = CHARGE_KW * EFFICIENCY          # kWh stored per hour
            delta_soc = bat_in_kwh / bat_kwh * 100.0
            grid_import_kwh = max(0.0, float(load_w[h]) / 1000.0 + CHARGE_KW
                                  - float(pv_w[h]) / 1000.0)
            soc = min(SOC_MAX, soc + delta_soc)

        elif action == MODE_FORCE_DISCHARGE:
            # Discharge at DISCHARGE_KW to offset load / export.
            bat_out_kwh = DISCHARGE_KW / EFFICIENCY      # kWh drawn from battery per hour
            delta_soc = -bat_out_kwh / bat_kwh * 100.0
            net_import_w = float(load_w[h]) - float(pv_w[h]) - DISCHARGE_KW * 1000.0
            grid_import_kwh = max(0.0, net_import_w / 1000.0)
            soc = max(SOC_MIN, soc + delta_soc)

        else:  # MODE_AUTO
            balance_kwh = balance_w / 1000.0
            if balance_kwh >= 0:
                # Surplus: charge battery, no grid import.
                headroom = (SOC_MAX - soc) / 100.0 * bat_kwh
                bat_in = min(balance_kwh * EFFICIENCY, headroom)
                soc = soc + bat_in / bat_kwh * 100.0
                grid_import_kwh = 0.0
            else:
                # Deficit: discharge battery, then import remainder.
                available_kwh = max(0.0, (soc - SOC_MIN) / 100.0 * bat_kwh)
                bat_out = min(-balance_kwh / EFFICIENCY, available_kwh)
                soc = soc - bat_out * EFFICIENCY / bat_kwh * 100.0  # approximate
                grid_import_kwh = max(0.0, -balance_kwh - bat_out)

        soc = max(0.0, min(100.0, soc))
        soc_traj.append(soc)
        total_cost += grid_import_kwh * price / PRICE_SCALE  # PLN

    return soc_traj, total_cost


def solve(current_soc, forecast, current_hour=None, bat_kwh=BATTERY_KWH):
    """Compute the MPC schedule for the next 24 hours.

    Args:
        current_soc:  current battery SoC in percent.
        forecast:     dict from ForecastEngine.predict_next_24h() with keys
                      "pv" (W), "load" (W), "price" (gr/kWh) — each a 24-element list.
        current_hour: wall-clock hour (0-23) for labelling.  Uses datetime.now() if None.
        bat_kwh:      battery capacity in kWh.

    Returns:
        MPCResult
    """
    import datetime
    if current_hour is None:
        current_hour = datetime.datetime.now().hour

    pv = np.array(forecast.get("pv", [0.0] * 24), dtype=np.float64)[:24]
    load = np.array(forecast.get("load", [0.0] * 24), dtype=np.float64)[:24]
    price = np.array(forecast.get("price", [0.0] * 24), dtype=np.float64)[:24]

    # ── Baseline: all auto ───────────────────────────────────────────────────
    schedule = [MODE_AUTO] * 24
    baseline_traj, naive_cost = _simulate(current_soc, pv, load, price, schedule, bat_kwh)

    # ── Greedy local search ──────────────────────────────────────────────────
    best_schedule = schedule[:]
    best_cost = naive_cost

    # Sorted indices: expensive hours first (discharge candidates),
    #                 cheap hours first (charge candidates).
    expensive_hours = sorted(range(24), key=lambda h: -price[h])
    cheap_hours = sorted(range(24), key=lambda h: price[h])

    price_p75 = float(np.percentile(price, 75))
    price_p25 = float(np.percentile(price, 25))

    for _ in range(3):  # up to 3 passes (converges quickly)
        changed = False
        soc_traj, _ = _simulate(current_soc, pv, load, price, best_schedule, bat_kwh)

        # Try discharging at high-price hours
        for h in expensive_hours:
            if price[h] <= price_p75:
                continue
            if best_schedule[h] != MODE_AUTO:
                continue
            soc_before = (soc_traj[h - 1] if h > 0 else current_soc)
            if soc_before <= SOC_MIN + 10:
                continue  # not enough charge to discharge
            candidate = best_schedule[:]
            candidate[h] = MODE_FORCE_DISCHARGE
            _, new_cost = _simulate(current_soc, pv, load, price, candidate, bat_kwh)
            if new_cost < best_cost - 0.001:
                best_schedule = candidate
                best_cost = new_cost
                changed = True

        # Try grid-charging at cheap hours to enable future discharge
        for h in cheap_hours:
            if price[h] >= price_p25:
                continue
            if best_schedule[h] != MODE_AUTO:
                continue
            soc_before = (soc_traj[h - 1] if h > 0 else current_soc)
            if soc_before >= SOC_MAX - 5:
                continue  # already near full
            candidate = best_schedule[:]
            candidate[h] = MODE_FORCE_CHARGE
            _, new_cost = _simulate(current_soc, pv, load, price, candidate, bat_kwh)
            if new_cost < best_cost - 0.001:
                best_schedule = candidate
                best_cost = new_cost
                changed = True

        if not changed:
            break

    _, best_cost_final = _simulate(current_soc, pv, load, price, best_schedule, bat_kwh)
    savings = naive_cost - best_cost_final
    current_action = best_schedule[current_hour % 24]

    _action_name = {MODE_AUTO: "auto", MODE_FORCE_CHARGE: "charge",
                    MODE_FORCE_DISCHARGE: "discharge"}
    log.info(
        "[MPC] h=%02d action=%s  cost=%.3f PLN  naive=%.3f PLN  savings=%.3f PLN",
        current_hour, _action_name.get(current_action, "?"),
        best_cost_final, naive_cost, savings,
    )

    return MPCResult(
        schedule=best_schedule,
        cost_estimate=round(best_cost_final, 4),
        naive_cost=round(naive_cost, 4),
        savings=round(savings, 4),
        current_action=current_action,
    )
