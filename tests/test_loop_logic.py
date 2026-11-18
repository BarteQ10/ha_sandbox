import random

from ems_simulator.battery import MODE_AUTO, MODE_FORCE_CHARGE, MODE_FORCE_DISCHARGE
from ems_simulator.config import GRID_BLACKOUT, GRID_INSTABILITY, GRID_NORMAL
from ems_simulator.loop_logic import (
    apply_instability,
    base_force,
    compute_balance,
    island_shed,
    resolve_force,
    self_consumption_shed,
    step_hours,
    tick_cost_pln,
)

# ── compute_balance ──────────────────────────────────────────────────────────

def test_compute_balance_includes_v2g():
    assert compute_balance(1000, 500, 1200) == 300
    assert compute_balance(0, 0, 800) == -800


# ── base_force ───────────────────────────────────────────────────────────────

def test_base_force_manual_always_wins():
    # A manual force mode is never overridden by RL or MPC.
    assert base_force(MODE_FORCE_DISCHARGE, MODE_FORCE_CHARGE, MODE_FORCE_CHARGE) \
        == MODE_FORCE_DISCHARGE


def test_base_force_rl_over_mpc():
    assert base_force(MODE_AUTO, MODE_FORCE_DISCHARGE, MODE_FORCE_CHARGE) \
        == MODE_FORCE_DISCHARGE


def test_base_force_mpc_when_rl_auto():
    assert base_force(MODE_AUTO, MODE_AUTO, MODE_FORCE_CHARGE) == MODE_FORCE_CHARGE


def test_base_force_stays_auto():
    assert base_force(MODE_AUTO, MODE_AUTO, MODE_AUTO) == MODE_AUTO


# ── resolve_force ────────────────────────────────────────────────────────────

def test_resolve_force_storm_overrides_everything():
    assert resolve_force(MODE_FORCE_DISCHARGE, MODE_AUTO, MODE_AUTO,
                         storm_safe=True, grid_status=GRID_NORMAL) == MODE_FORCE_CHARGE


def test_resolve_force_blackout_cancels_force_charge():
    # Storm wants force-charge, but a blackout means no grid → back to Auto.
    assert resolve_force(MODE_AUTO, MODE_AUTO, MODE_AUTO,
                         storm_safe=True, grid_status=GRID_BLACKOUT) == MODE_AUTO


def test_resolve_force_blackout_leaves_discharge_alone():
    assert resolve_force(MODE_FORCE_DISCHARGE, MODE_AUTO, MODE_AUTO,
                         storm_safe=False, grid_status=GRID_BLACKOUT) == MODE_FORCE_DISCHARGE


def test_resolve_force_passthrough():
    assert resolve_force(MODE_AUTO, MODE_AUTO, MODE_FORCE_CHARGE,
                         storm_safe=False, grid_status=GRID_NORMAL) == MODE_FORCE_CHARGE


# ── tick_cost_pln ────────────────────────────────────────────────────────────

DT_H = 1.0 / 12.0  # one tick = 5 sim-min


def test_tick_cost_import_adds_distribution():
    # importing 1000 W for 1/12 h at 50 gr RCE + 28 gr distribution = 78 gr effective
    cost = tick_cost_pln(-1000, 50, 28, DT_H, GRID_NORMAL)
    expected = 1000 * 78 * DT_H / (100.0 * 1000.0)
    assert abs(cost - expected) < 1e-9
    assert cost > 0  # spending


def test_tick_cost_export_ignores_distribution():
    cost = tick_cost_pln(1000, 50, 28, DT_H, GRID_NORMAL)
    expected = -1000 * 50 * DT_H / (100.0 * 1000.0)
    assert abs(cost - expected) < 1e-9
    assert cost < 0  # revenue


def test_tick_cost_blackout_is_zero():
    assert tick_cost_pln(-5000, 80, 28, DT_H, GRID_BLACKOUT) == 0.0


# ── apply_instability ────────────────────────────────────────────────────────

def test_apply_instability_is_deterministic_with_seed():
    a = apply_instability(3000, 2000, 40, random.Random(7))
    b = apply_instability(3000, 2000, 40, random.Random(7))
    assert a == b


def test_apply_instability_price_always_inflates():
    # price multiplier is in [1.0, 2.5] → never below the original
    for seed in range(20):
        pv, load, price = apply_instability(3000, 2000, 40, random.Random(seed))
        assert price >= 40
        assert pv <= 3000  # PV can only derate or stay
        assert pv >= 0


# ── self_consumption_shed ────────────────────────────────────────────────────

def test_shed_inactive_when_grid_ok_or_soc_high():
    # No deficit / SoC not low → no shed.
    out = self_consumption_shed(
        2000, 500, soc=50, grid_status=GRID_NORMAL,
        ev_eff=3700, hp_eff=0, boiler_eff=0, pv=2500, v2g_power=0)
    boiler, hp, ev, load, balance, shed = out
    assert shed == []
    assert (boiler, hp, ev, load, balance) == (0, 0, 3700, 2000, 500)


def test_shed_priority_ev_first():
    out = self_consumption_shed(
        5000, -1000, soc=15, grid_status=GRID_NORMAL,
        ev_eff=3700, hp_eff=2, boiler_eff=1, pv=1000, v2g_power=0)
    boiler, hp, ev, load, balance, shed = out
    assert shed == [("EV", 3700)]
    assert load == 5000 - 3700
    assert balance == compute_balance(1000, 0, 1300)
    # Only the shed device is switched off; the others keep running.
    assert (ev, hp, boiler) == (0, 2, 1)


def test_shed_hp_when_no_ev():
    out = self_consumption_shed(
        5000, -1000, soc=15, grid_status=GRID_NORMAL,
        ev_eff=0, hp_eff=2, boiler_eff=1, pv=1000, v2g_power=0)
    boiler, hp, ev, load, balance, shed = out
    assert shed == [("HP", 3000)]
    assert (hp, boiler) == (0, 1)


def test_shed_boiler_last():
    out = self_consumption_shed(
        5000, -1000, soc=15, grid_status=GRID_NORMAL,
        ev_eff=0, hp_eff=0, boiler_eff=1, pv=1000, v2g_power=0)
    boiler, hp, ev, load, balance, shed = out
    assert shed == [("boiler", 3000)]
    assert boiler == 0


def test_shed_balance_keeps_v2g():
    # Regression: V2G power must stay in the recomputed balance after shedding.
    out = self_consumption_shed(
        5000, -1000, soc=15, grid_status=GRID_NORMAL,
        ev_eff=0, hp_eff=0, boiler_eff=1, pv=1000, v2g_power=800)
    boiler, hp, ev, load, balance, shed = out
    assert shed == [("boiler", 3000)]
    assert balance == compute_balance(1000, 800, 2000)  # 1000 + 800 - 2000 = -200


def test_shed_switches_the_device_off_so_the_registers_agree():
    """The watts leave `load`, so they have to leave the device too.

    This used to return the device untouched: registers 3/4/5, MQTT and
    InfluxDB kept reporting it at full power while the total load no longer
    contained it, so the dashboard's own figures stopped adding up — and the
    caller had nothing to reset the anti-chatter timer from.
    """
    out = self_consumption_shed(
        5000, -1000, soc=15, grid_status=GRID_NORMAL,
        ev_eff=3700, hp_eff=0, boiler_eff=0, pv=1000, v2g_power=0)
    boiler, hp, ev, load, balance, shed = out

    assert ev == 0                                  # the register will say "off"
    assert load == 1300                             # and the load agrees
    assert [dev for dev, _w in shed] == ["EV"]      # the caller can reset its timer


def test_shed_falls_through_an_hp_in_an_unknown_mode():
    """An HP mode with no power entry contributes 0 W, so the boiler goes."""
    out = self_consumption_shed(
        5000, -1000, soc=15, grid_status=GRID_NORMAL,
        ev_eff=0, hp_eff=9, boiler_eff=1, pv=1000, v2g_power=0)
    boiler, hp, ev, load, balance, shed = out

    assert shed == [("boiler", 3000)]
    assert (boiler, hp) == (0, 9)   # the HP is left exactly as it was


def test_shed_reports_nothing_when_there_is_nothing_sheddable():
    out = self_consumption_shed(
        5000, -1000, soc=15, grid_status=GRID_NORMAL,
        ev_eff=0, hp_eff=0, boiler_eff=0, pv=1000, v2g_power=0)
    boiler, hp, ev, load, balance, shed = out

    assert shed == []
    assert (load, balance) == (5000, -1000)   # untouched


# ── island_shed ──────────────────────────────────────────────────────────────

def test_island_shed_inactive_outside_blackout():
    out = island_shed(1, 2, 3700, 5000, -1000, soc=3,
                      grid_status=GRID_NORMAL, pv=0, v2g_power=0)
    boiler, hp, ev, load, balance, shed = out
    assert shed == []
    assert (boiler, hp, ev, load, balance) == (1, 2, 3700, 5000, -1000)


def test_island_shed_drops_all_loads_and_zeroes_modes():
    boiler, hp, ev, load, balance, shed = island_shed(
        1, 2, 3700, 5000, -2000, soc=4, grid_status=GRID_BLACKOUT, pv=500, v2g_power=0)
    assert boiler == 0 and hp == 0 and ev == 0
    assert {d for d, _ in shed} == {"boiler", "EV", "HP"}
    # 5000 - 3000(boiler) - 3700(ev) - 3000(hp boost) = -4700
    assert load == 5000 - 3000 - 3700 - 3000
    assert balance == compute_balance(500, 0, load)


def test_island_shed_keeps_v2g_in_balance():
    *_, balance, shed = island_shed(
        1, 0, 0, 4000, -2000, soc=4, grid_status=GRID_BLACKOUT, pv=500, v2g_power=600)
    assert shed == [("boiler", 3000)]
    assert balance == compute_balance(500, 600, 1000)  # 500 + 600 - 1000 = 100


def test_instability_constant_imported():
    # guard against accidental rename of the grid-status constant
    assert GRID_INSTABILITY == 2


def test_step_hours_maps_sample_count_to_duration():
    """24 samples a day are hourly, 96 are quarter-hourly. Every power-to-energy
    conversion scales by this, and forgetting it is a silent 4x error."""
    assert step_hours([0] * 24) == 1.0
    assert step_hours([0] * 96) == 0.25
    assert step_hours([0] * 48) == 0.5
    assert step_hours([]) == 1.0          # no samples: nothing to scale
