import math

from ems_simulator.battery import (
    delta, clamp, MODE_AUTO, MODE_FORCE_CHARGE, MODE_FORCE_DISCHARGE, FORCE_RATE_W,
)
from ems_simulator.config import SOC_DELTA_DENOM, INVERTER_EFFICIENCY


def test_clamp_bounds():
    assert clamp(-5) == 0.0
    assert clamp(150) == 100.0
    assert clamp(42.5) == 42.5


def test_force_charge_applies_efficiency():
    d = delta(0, MODE_FORCE_CHARGE)
    assert math.isclose(d, FORCE_RATE_W * INVERTER_EFFICIENCY / SOC_DELTA_DENOM)
    assert d > 0


def test_force_discharge_divides_by_efficiency():
    d = delta(0, MODE_FORCE_DISCHARGE)
    assert math.isclose(d, -(FORCE_RATE_W / INVERTER_EFFICIENCY) / SOC_DELTA_DENOM)
    assert d < 0


def test_auto_charge_and_discharge_signs():
    assert delta(1080, MODE_AUTO) > 0   # surplus charges
    assert delta(-1080, MODE_AUTO) < 0  # deficit discharges


def test_aging_factor_increases_delta_magnitude():
    healthy = delta(1080, MODE_AUTO, aging_factor=1.0)
    aged = delta(1080, MODE_AUTO, aging_factor=0.5)
    # smaller effective capacity -> same power moves a larger SoC fraction
    assert aged > healthy
