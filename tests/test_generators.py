import random

import pytest

from ems_simulator.config import (
    EV_ARRIVAL_HOUR,
    EV_CHARGE_MAX_W,
    EV_DAILY_KWH_NEEDED,
    HP_COP_CURVE,
    STEPS_PER_DAY,
    STEPS_PER_HOUR,
    TICK_S,
)
from ems_simulator.generators import (
    DeviceTimer,
    EVProfile,
    StandbyDevice,
    controllable_load,
    hp_cop,
)
from ems_simulator.presence import PRESENCE_AWAY, PRESENCE_HOME


def test_hp_cop_none_and_clamps():
    assert hp_cop(None) == 3.0
    assert hp_cop(-50) == HP_COP_CURVE[0][1]   # below curve -> first
    assert hp_cop(100) == HP_COP_CURVE[-1][1]  # above curve -> last


def test_hp_cop_exact_and_interpolated():
    assert hp_cop(5) == 3.5            # exact knot
    assert hp_cop(2.5) == 3.25         # halfway between (0,3.0) and (5,3.5)


def test_controllable_load_devices():
    assert controllable_load(1, 0, 0) == (3000, 0)
    assert controllable_load(0, 1, 0, 3.0) == (1500, 4500)
    assert controllable_load(0, 2, 0, 3.0) == (3000, 9000)


def test_controllable_load_ev_capped():
    total, _ = controllable_load(0, 0, 99999)
    assert total == EV_CHARGE_MAX_W


def test_device_timer_enforces_min_on_then_min_off():
    t = DeviceTimer(min_on_sim_min=10, min_off_sim_min=10)  # 2 ticks each
    assert t.constrain(1) == 1   # turn on
    assert t.constrain(0) == 1   # min-on not met -> stays on
    assert t.constrain(1) == 1   # sustain (decrement timer)
    assert t.constrain(1) == 1   # sustain (timer now elapsed)
    assert t.constrain(0) == 0   # allowed off
    assert t.constrain(1) == 0   # min-off not met -> stays off


# ── StandbyDevice ─────────────────────────────────────────────────────────────

def _make_device(cut_threshold=0.0):
    """TV-like device: 5W standby, 120W active, evening window, no p_active."""
    return StandbyDevice("TV", 5.0, 120.0, 18.0, 23.0, 0.0, cut_threshold)


def test_standby_device_returns_standby_w_when_idle():
    d = _make_device()
    w, cut = d.tick(10.0, PRESENCE_HOME)   # outside active window
    assert w == 5.0
    assert cut is False


def test_standby_device_never_cut_when_threshold_zero():
    d = _make_device(cut_threshold=0.0)
    for _ in range(100):
        w, cut = d.tick(10.0, PRESENCE_AWAY)
        assert cut is False
        assert w > 0  # always standby, never cut


def test_standby_device_cut_when_away_and_idle(monkeypatch):
    # Patch the name as bound in generators module (not in config)
    from ems_simulator import generators as g
    monkeypatch.setattr(g, "STANDBY_CUT_AFTER_TICKS", 1)
    monkeypatch.setattr(g, "STANDBY_RESTORE_AFTER_TICKS", 5)

    d = StandbyDevice("TV", 5.0, 120.0, 18.0, 23.0, 0.0, cut_threshold_w=7.0)
    w1, cut1 = d.tick(10.0, PRESENCE_AWAY)   # 1st standby tick → cut triggered
    assert cut1 is True
    assert w1 == 0.0


def test_standby_device_not_cut_when_home(monkeypatch):
    from ems_simulator import generators as g
    monkeypatch.setattr(g, "STANDBY_CUT_AFTER_TICKS", 1)

    d = StandbyDevice("TV", 5.0, 120.0, 18.0, 23.0, 0.0, cut_threshold_w=7.0)
    w, cut = d.tick(10.0, PRESENCE_HOME)
    assert cut is False
    assert w == 5.0  # standby, not cut


def test_standby_device_cut_zeros_power_during_cut(monkeypatch):
    from ems_simulator import generators as g
    monkeypatch.setattr(g, "STANDBY_CUT_AFTER_TICKS", 1)
    monkeypatch.setattr(g, "STANDBY_RESTORE_AFTER_TICKS", 2)

    d = StandbyDevice("TV", 5.0, 120.0, 18.0, 23.0, 0.0, cut_threshold_w=7.0)
    _, cut = d.tick(10.0, PRESENCE_AWAY)   # (A) cut triggered, remaining=2
    assert cut is True
    assert d.is_cut

    wB, _ = d.tick(10.0, PRESENCE_AWAY)   # (B) remaining → 1, still cut
    assert wB == 0.0
    assert d.is_cut

    wC, _ = d.tick(10.0, PRESENCE_AWAY)   # (C) remaining → 0, flag cleared
    assert wC == 0.0
    assert not d.is_cut                    # flag is gone after this tick


def test_standby_device_power_restores_when_home(monkeypatch):
    """After restore and returning home the standby power should come back."""
    from ems_simulator import generators as g
    monkeypatch.setattr(g, "STANDBY_CUT_AFTER_TICKS", 1)
    monkeypatch.setattr(g, "STANDBY_RESTORE_AFTER_TICKS", 1)

    d = StandbyDevice("TV", 5.0, 120.0, 18.0, 23.0, 0.0, cut_threshold_w=7.0)
    d.tick(10.0, PRESENCE_AWAY)            # cut
    d.tick(10.0, PRESENCE_AWAY)            # restore tick (_cut cleared)

    w, _ = d.tick(10.0, PRESENCE_HOME)    # home → no re-cut → standby power
    assert w == 5.0


def test_standby_device_active_resets_standby_counter(monkeypatch):
    """Going active resets the standby tick counter, preventing cut on next idle."""
    from ems_simulator import config as c
    monkeypatch.setattr(c, "STANDBY_CUT_AFTER_TICKS", 2)
    monkeypatch.setattr(random, "random", lambda: 0.0)  # always start active
    monkeypatch.setattr(random, "randint", lambda a, b: 1)  # active for 1 tick

    d = StandbyDevice("TV", 5.0, 120.0, 0.0, 24.0, 1.0, cut_threshold_w=7.0)
    d.tick(10.0, PRESENCE_AWAY)  # goes active (standby counter resets)
    # After active → back to standby; counter starts fresh, should not cut yet
    w, cut = d.tick(10.0, PRESENCE_AWAY)
    assert cut is False   # only 1 standby tick, need 2


# ── EVProfile ─────────────────────────────────────────────────────────────────

def _run_sim_day(ev, day_step):
    """Advance one simulated day exactly the way main()'s loop does.

    main() keeps `day_step = (day_step + 1) % STEPS_PER_DAY`, so the counter it
    hands to EVProfile.tick() never leaves a single day — which is the whole
    point of the tests below. Returns (day_step, kWh charged during that day).
    """
    tick_kwh = EV_CHARGE_MAX_W * TICK_S * 60.0 / (3600.0 * 1000.0)
    charged = 0.0
    for _ in range(STEPS_PER_DAY):
        day_step = (day_step + 1) % STEPS_PER_DAY
        plugged, needed = ev.tick(day_step, day_step / STEPS_PER_HOUR, 0)
        if plugged and needed > 1.0:
            step = min(tick_kwh, needed)
            ev.add_energy(step)
            charged += step
    return day_step, charged


def test_ev_profile_charges_on_every_simulated_day():
    """The EV has to keep charging after the first simulated day.

    The daily reset used to be derived from `day_step // 288`, which is a
    constant 0 for the wrapped counter main() passes: it fired once on the first
    tick and never again, so `energy_delivered_today` kept the first day's total,
    `energy_still_needed` stuck at 0 and the car was never charged again for the
    life of the process.
    """
    ev = EVProfile()
    day_step = 0
    charged = []
    for _ in range(3):
        day_step, kwh = _run_sim_day(ev, day_step)
        charged.append(kwh)

    assert all(k > EV_DAILY_KWH_NEEDED * 0.5 for k in charged), charged


def test_ev_profile_resets_today_when_day_step_wraps():
    """A wrap of the counter (23:55 -> 00:00) is what starts a new day here."""
    ev = EVProfile()
    ev.tick(STEPS_PER_DAY - 1, 23.9, 0)
    ev.add_energy(EV_DAILY_KWH_NEEDED)
    assert ev.energy_delivered_today == pytest.approx(EV_DAILY_KWH_NEEDED)

    ev.tick(0, 0.0, 0)
    assert ev.energy_delivered_today == 0.0


def test_ev_profile_keeps_restored_energy_through_the_first_tick():
    """main() restores today's EV energy from InfluxDB before the loop starts.

    The reset must not fire on that first tick, or the restore is discarded and
    the EV's SoC is drained for a departure that never happened.
    """
    ev = EVProfile()
    ev.restore_energy(6.0)
    soc_before = ev.ev_soc_pct

    ev.tick(int(EV_ARRIVAL_HOUR * STEPS_PER_HOUR), float(EV_ARRIVAL_HOUR), 0)

    assert ev.energy_delivered_today == pytest.approx(6.0)
    assert ev.ev_soc_pct == pytest.approx(soc_before)
