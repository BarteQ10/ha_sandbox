"""House RC thermal model: the physics, and the thermostat band around it.

t_house drives the heat-pump decision every tick, and the dead band is what
keeps the HP from chattering. The numbers below are computed from the config
constants rather than copied from a run, so a changed constant moves the
expectation with it instead of leaving a stale magic number.
"""
import pytest

from ems_simulator.config import (
    HOUSE_DEAD_BAND_C,
    HOUSE_INITIAL_TEMP_C,
    HOUSE_SETPOINT_C,
    HOUSE_THERMAL_MASS_KWH_PER_C,
    HOUSE_UA_W_PER_C,
)
from ems_simulator.thermal import _DT_SIM_S, ThermalModel


def _expected_delta(t_house, t_outside, hp_w):
    """°C per tick straight from dT = (Q_hp - UA*dT_air) * dt / C."""
    q_net = hp_w - HOUSE_UA_W_PER_C * (t_house - t_outside)
    return q_net * _DT_SIM_S / (HOUSE_THERMAL_MASS_KWH_PER_C * 3.6e6)


def test_starts_at_the_configured_temperature():
    assert ThermalModel().t_house == HOUSE_INITIAL_TEMP_C


def test_no_outdoor_reading_freezes_the_house():
    """A failed weather fetch must not silently cool the house to nothing."""
    m = ThermalModel()
    before = m.t_house
    assert m.tick(None, 0) == before
    assert m.t_house == before
    assert m.hp_hours_on == 0.0


def test_cooling_matches_the_rc_formula():
    m = ThermalModel()
    start = m.t_house
    expected = _expected_delta(start, 0.0, 0.0)

    after = m.tick(0.0, 0)

    assert expected < 0                       # 20 °C house, 0 °C outside: heat leaves
    assert after == pytest.approx(start + expected)


def test_heating_matches_the_rc_formula():
    m = ThermalModel()
    start = m.t_house
    expected = _expected_delta(start, 0.0, 5000.0)

    after = m.tick(0.0, 5000.0)

    assert expected > 0
    assert after == pytest.approx(start + expected)


def test_heat_exactly_matching_the_loss_holds_the_temperature():
    """The equilibrium point: Q_hp == UA * (T_in - T_out) means no change."""
    m = ThermalModel()
    t_outside = 0.0
    balanced_w = HOUSE_UA_W_PER_C * (m.t_house - t_outside)

    after = m.tick(t_outside, balanced_w)

    assert after == pytest.approx(m.t_house)
    assert after == pytest.approx(HOUSE_INITIAL_TEMP_C)


def test_an_outdoor_temperature_above_the_house_warms_it():
    m = ThermalModel()
    start = m.t_house
    assert m.tick(start + 10.0, 0) > start


def test_hp_runtime_accrues_only_while_the_pump_runs():
    m = ThermalModel()
    per_tick_h = _DT_SIM_S / 3600.0

    m.tick(0.0, 0)
    assert m.hp_hours_on == 0.0

    m.tick(0.0, 3000.0)
    m.tick(0.0, 3000.0)
    assert m.hp_hours_on == pytest.approx(2 * per_tick_h)


def test_the_dead_band_leaves_a_neutral_zone():
    """Inside the band neither request fires — that is what stops HP chattering."""
    m = ThermalModel()

    m.t_house = HOUSE_SETPOINT_C
    assert m.wants_heat() is False
    assert m.wants_idle() is False

    m.t_house = HOUSE_SETPOINT_C - HOUSE_DEAD_BAND_C - 0.01
    assert m.wants_heat() is True

    m.t_house = HOUSE_SETPOINT_C + HOUSE_DEAD_BAND_C
    assert m.wants_idle() is True


def test_the_band_edges_do_not_both_trigger():
    m = ThermalModel()
    for offset in (-HOUSE_DEAD_BAND_C, 0.0, HOUSE_DEAD_BAND_C - 0.01):
        m.t_house = HOUSE_SETPOINT_C + offset
        assert not (m.wants_heat() and m.wants_idle())


def test_log_status_survives_a_missing_outdoor_reading():
    ThermalModel().log_status(None)
    ThermalModel().log_status(-7.5)
