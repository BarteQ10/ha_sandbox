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
from ems_simulator.loop_logic import step_hours
from ems_simulator.pricing import distribution_rate

log = logging.getLogger(__name__)

CHARGE_KW = 5.0       # max grid charge rate
DISCHARGE_KW = 5.0    # max battery discharge rate
EFFICIENCY = 0.92     # round-trip: applies on charge IN and discharge OUT
SOC_MAX = 90.0        # upper SoC target (%)
SOC_MIN = 20.0        # lower SoC guard (%)
# gr → PLN. The energy multiplied by the price below is in kWh, so
# kWh * gr/kWh / 100 = PLN. This used to be 100 * 1000, which is the right
# denominator only for Wh (loop_logic.tick_cost_pln does feed it Wh). Every cost
# and saving reported from here was therefore 1000x too small — and since the
# accept threshold in solve() is an absolute 0.001, the optimizer was silently
# rejecting every move worth less than ~1 PLN.
PRICE_SCALE = 100.0

# Smallest modelled saving (PLN) that justifies overriding auto mode for an hour.
# Deliberately permissive: the cost model counts only grid import, so it ignores
# the wear of the extra cycle it is buying. A move worth a few grosze may not be
# worth a third of a battery cycle — making that trade-off properly needs a wear
# term in _simulate, which this threshold is only a blunt stand-in for.
MIN_GAIN_PLN = 0.001

# Greedy sweeps per 24 steps of schedule. Each sweep only accepts moves that pay
# for themselves, so a finer resolution needs more sweeps to assemble the same
# plan: at 96 quarter-hour steps a single move shifts a quarter of the energy an
# hourly move would, and three sweeps left a plan that cost MORE against real
# prices than the hourly one did. Measured on a day with one cheap quarter:
# 3 sweeps 78.13 PLN, 6 sweeps 77.76, 12 sweeps 77.34, 24 sweeps 77.34 — so it
# converges at 4 sweeps per 24 steps. The loop breaks as soon as a sweep changes
# nothing, which makes a generous cap free at coarser resolutions.
PASSES_PER_24_STEPS = 4


@dataclass
class MPCResult:
    schedule: list[int]          # one MODE_* per step (24 hourly or 96 quarters)
    cost_estimate: float         # projected cost with MPC (PLN)
    naive_cost: float            # projected cost without MPC (PLN)
    savings: float               # naive_cost - cost_estimate (PLN)
    current_action: int = MODE_AUTO  # recommended action for the current hour


def _simulate(soc0, pv_w, load_w, price_gr, schedule, bat_kwh=BATTERY_KWH, step_h=None):
    """Forward-simulate SoC and grid-import cost for a given 24-hour schedule.

    `price_gr` is the *effective import price* per step in gr/kWh — the energy
    price plus that step's distribution rate. solve() assembles it, so the hour
    bookkeeping stays in one place and this stays tariff-agnostic.

    The schedule covers one day at whatever resolution it is given: 24 hourly
    steps or 96 quarter-hourly ones. Every power-to-energy conversion below is
    scaled by `step_h`, so the same curve costs the same either way. It defaults
    to a day spread over the schedule, but say it explicitly for a partial
    schedule — a one-element list is otherwise read as a single 24-hour step.

    Returns (soc_trajectory: list[float], total_cost: float).
    """
    n = len(schedule)
    if step_h is None:
        step_h = step_hours(schedule)
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
            bat_in_kwh = CHARGE_KW * step_h * EFFICIENCY
            delta_soc = bat_in_kwh / bat_kwh * 100.0
            grid_import_kwh = max(0.0, (float(load_w[h]) / 1000.0 + CHARGE_KW
                                        - float(pv_w[h]) / 1000.0) * step_h)
            soc = min(SOC_MAX, soc + delta_soc)

        elif action == MODE_FORCE_DISCHARGE:
            # Discharge at DISCHARGE_KW to offset load / export.
            bat_out_kwh = DISCHARGE_KW * step_h / EFFICIENCY
            delta_soc = -bat_out_kwh / bat_kwh * 100.0
            net_import_w = float(load_w[h]) - float(pv_w[h]) - DISCHARGE_KW * 1000.0
            grid_import_kwh = max(0.0, net_import_w / 1000.0 * step_h)
            soc = max(SOC_MIN, soc + delta_soc)

        else:  # MODE_AUTO
            balance_kwh = balance_w / 1000.0 * step_h
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
                      "pv" (W), "load" (W), "price" (gr/kWh). The lists cover one
                      day at whatever resolution they carry — 24 hourly samples
                      or 96 quarter-hourly ones — and the schedule comes back at
                      the same resolution.
        current_hour: wall-clock hour (0-23) for labelling.  Uses datetime.now() if None.
        bat_kwh:      battery capacity in kWh.

    Returns:
        MPCResult
    """
    import datetime
    if current_hour is None:
        current_hour = datetime.datetime.now().hour

    energy_price = np.array(forecast.get("price") or [0.0] * 24, dtype=np.float64)
    n = len(energy_price)
    step_h = step_hours(energy_price)
    pv = np.array(forecast.get("pv") or [0.0] * n, dtype=np.float64)[:n]
    load = np.array(forecast.get("load") or [0.0] * n, dtype=np.float64)[:n]

    # Import is billed at the energy price PLUS the hour's distribution rate,
    # exactly as loop_logic.tick_cost_pln and backtest.py bill it. This module
    # used to cost everything at the raw RCE price alone, which understated every
    # import by 12-28 gr/kWh and — because the rate is time-of-use — misranked
    # which hours are actually the expensive ones.
    #
    # Index i is i *steps* from `current_hour`, not hour-of-day (the forecast
    # window starts at "now"), so the wall-clock hour of step i is
    # current_hour + i * step_h — one hour apart at 24 samples, 15 minutes apart
    # at 96.
    price = np.array([energy_price[i] + distribution_rate((current_hour + i * step_h) % 24)
                      for i in range(n)], dtype=np.float64)

    # ── Baseline: all auto ───────────────────────────────────────────────────
    schedule = [MODE_AUTO] * n
    baseline_traj, naive_cost = _simulate(current_soc, pv, load, price, schedule,
                                          bat_kwh, step_h)

    # ── Greedy local search ──────────────────────────────────────────────────
    best_schedule = schedule[:]
    best_cost = naive_cost

    # Candidate order only decides which move is tried first; every move still
    # has to pay for itself against _simulate below.
    #
    # There used to be a price-quartile pre-filter here (charge only below p25,
    # discharge only above p75). It made this whole search a no-op on the most
    # ordinary curve there is: with cheap power all night and a short evening
    # peak, 19 of 24 hours sit at the minimum, so p25 collapses onto that
    # minimum and `price[h] >= p25` excluded every cheap hour from charging —
    # leaving nothing in the battery to discharge into the peak either.
    # The filter could only ever reject candidates, and the cost comparison is
    # the real criterion, so dropping it cannot return a worse schedule.
    expensive_hours = sorted(range(n), key=lambda h: -price[h])
    cheap_hours = sorted(range(n), key=lambda h: price[h])

    sweeps = max(PASSES_PER_24_STEPS, round(PASSES_PER_24_STEPS * n / 24))
    for _ in range(sweeps):
        changed = False
        # SoC trajectory for the guards below. Refreshed once per pass, not after
        # every accepted move, so a later move in the same pass may judge SoC
        # from a slightly stale trajectory; the next pass corrects it.
        soc_traj, _ = _simulate(current_soc, pv, load, price, best_schedule, bat_kwh, step_h)

        # Grid-charge first: a discharge is only possible once there is something
        # to discharge, and the baseline trajectory is usually near-empty.
        for h in cheap_hours:
            if best_schedule[h] != MODE_AUTO:
                continue
            soc_before = (soc_traj[h - 1] if h > 0 else current_soc)
            if soc_before >= SOC_MAX - 5:
                continue  # already near full
            candidate = best_schedule[:]
            candidate[h] = MODE_FORCE_CHARGE
            _, new_cost = _simulate(current_soc, pv, load, price, candidate, bat_kwh, step_h)
            if new_cost < best_cost - MIN_GAIN_PLN:
                best_schedule = candidate
                best_cost = new_cost
                changed = True

        # Then discharge into the expensive hours.
        for h in expensive_hours:
            if best_schedule[h] != MODE_AUTO:
                continue
            soc_before = (soc_traj[h - 1] if h > 0 else current_soc)
            if soc_before <= SOC_MIN + 10:
                continue  # not enough charge to discharge
            candidate = best_schedule[:]
            candidate[h] = MODE_FORCE_DISCHARGE
            _, new_cost = _simulate(current_soc, pv, load, price, candidate, bat_kwh, step_h)
            if new_cost < best_cost - MIN_GAIN_PLN:
                best_schedule = candidate
                best_cost = new_cost
                changed = True

        if not changed:
            break

    _, best_cost_final = _simulate(current_soc, pv, load, price, best_schedule, bat_kwh, step_h)
    savings = naive_cost - best_cost_final

    # Index 0 IS the current hour — the forecast window starts at "now" — so the
    # action to apply right now is the first one. This used to index by
    # current_hour, which at 14:00 handed the inverter the action planned for
    # 04:00 the following day; only at midnight did the two agree.
    current_action = best_schedule[0]

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
