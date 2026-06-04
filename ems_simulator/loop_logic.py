"""Pure per-tick decision helpers extracted from ``main.py``'s loop.

These hold the simulation logic that previously lived inline in the single big
``main()`` loop, so it can be unit-tested in isolation. They are pure: no I/O,
no module-level state. The loop in ``main.py`` still owns timing, registers,
InfluxDB, MQTT and logging — it calls into these for the per-tick decisions.
"""
from ems_simulator.battery import MODE_AUTO, MODE_FORCE_CHARGE
from ems_simulator.config import GRID_BLACKOUT, GRID_NORMAL

# Heat-pump electrical power per mode (W): 1 = Comfort, 2 = Boost.
_HP_POWER = {1: 1500, 2: 3000}
_BOILER_POWER = 3000


def compute_balance(pv: float, v2g_power: float, load: float) -> float:
    """Net power into the system: PV + V2G discharge − house load (W)."""
    return pv + v2g_power - load


def base_force(force: int, rl_action: int, mpc_action: int) -> int:
    """Inverter mode after the RL/MPC override, before storm/blackout handling.

    A manual Force Charge/Discharge (``force != AUTO``) always wins. When the
    user leaves it on Auto, RL takes priority over MPC.
    """
    if force == MODE_AUTO:
        if rl_action != MODE_AUTO:
            return rl_action
        if mpc_action != MODE_AUTO:
            return mpc_action
    return force


def resolve_force(force: int, rl_action: int, mpc_action: int,
                  storm_safe: bool, grid_status: int) -> int:
    """Final inverter mode for the tick.

    Storm safeguard forces charging to 100%; a blackout cancels any force-charge
    (no grid to draw from) back to Auto.
    """
    actual = base_force(force, rl_action, mpc_action)
    if storm_safe:
        actual = MODE_FORCE_CHARGE
    if grid_status == GRID_BLACKOUT and actual == MODE_FORCE_CHARGE:
        actual = MODE_AUTO
    return actual


def tick_cost_pln(balance: float, price_gr: float, dist_rate_gr: float,
                  dt_h: float, grid_status: int) -> float:
    """Financial cost for one tick in PLN (positive = spend, negative = revenue).

    Import (``balance < 0``) pays the distribution tariff on top of the RCE
    price; export pays the RCE price only. No cost is tracked during a blackout.
    """
    if grid_status == GRID_BLACKOUT:
        return 0.0
    effective_price = price_gr + dist_rate_gr if balance < 0 else price_gr
    return -balance * effective_price * dt_h / (100.0 * 1000.0)


def apply_instability(pv: int, load: int, price: int, rng) -> tuple[int, int, int]:
    """Grid-instability mutations: PV derate, load surge/drop, price volatility.

    ``rng`` is a ``random.Random``-like object (the caller passes the module or a
    seeded instance so tests are deterministic). Returns the mutated triple.
    """
    if rng.random() < 0.3:                       # 30% of ticks: PV derates
        pv = int(pv * rng.uniform(0.4, 0.9))
    if rng.random() < 0.2:                       # 20% of ticks: load surge/drop
        load = int(load * rng.uniform(0.85, 1.3))
    price = int(price * rng.uniform(1.0, 2.5))   # price volatility
    return pv, load, price


def self_consumption_shed(load: int, balance: float, soc: float, grid_status: int,
                          ev_eff: int, hp_eff: int, boiler_eff: int,
                          pv: int, v2g_power: int):
    """Shed one non-essential load (EV → HP → boiler priority) on low SoC + deficit.

    Fires only when grid-connected, SoC < 20% and there's a power deficit, to
    prevent deep discharge / expensive import. Returns
    ``(load, balance, shed)`` where ``shed`` is ``None`` or a ``(device, watts)``
    tuple for the caller to log.
    """
    if not (grid_status == GRID_NORMAL and balance < 0 and soc < 20):
        return load, balance, None
    shed_w = 0
    shed = None
    if ev_eff > 0:
        shed_w = ev_eff
        shed = ("EV", ev_eff)
    if shed_w == 0 and hp_eff > 0:
        shed_w = _HP_POWER.get(hp_eff, 0)
        shed = ("HP", shed_w)
    if shed_w == 0 and boiler_eff > 0:
        shed_w = _BOILER_POWER
        shed = ("boiler", _BOILER_POWER)
    if shed_w > 0:
        load -= shed_w
        balance = compute_balance(pv, v2g_power, load)
    else:
        shed = None
    return load, balance, shed


def island_shed(boiler_eff: int, hp_eff: int, ev_eff: int, load: int, balance: float,
                soc: float, grid_status: int, pv: int, v2g_power: int):
    """Emergency load shed in island mode (blackout + SoC ≤ 5% + deficit).

    Sheds boiler, EV and HP unconditionally (bypasses anti-chatter timers).
    Returns ``(boiler_eff, hp_eff, ev_eff, load, balance, shed)`` where ``shed``
    is a list of ``(device, watts)`` tuples so the caller can reset the matching
    ``DeviceTimer`` and log.
    """
    if not (grid_status == GRID_BLACKOUT and soc <= 5 and balance < 0):
        return boiler_eff, hp_eff, ev_eff, load, balance, []
    shed = []
    if boiler_eff > 0:
        load -= _BOILER_POWER
        boiler_eff = 0
        shed.append(("boiler", _BOILER_POWER))
    if ev_eff > 0:
        shed.append(("EV", ev_eff))
        load -= ev_eff
        ev_eff = 0
    if hp_eff > 0:
        hp_save = _HP_POWER.get(hp_eff, 0)
        load -= hp_save
        hp_eff = 0
        shed.append(("HP", hp_save))
    balance = compute_balance(pv, v2g_power, load)
    return boiler_eff, hp_eff, ev_eff, load, balance, shed
