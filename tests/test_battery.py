import math

from ems_simulator import battery
from ems_simulator.battery import (
    FORCE_RATE_W,
    MODE_AUTO,
    MODE_FORCE_CHARGE,
    MODE_FORCE_DISCHARGE,
    clamp,
    delta,
    equivalent_cycles,
    soh,
    throughput_kwh,
)
from ems_simulator.config import (
    BATTERY_CYCLE_LIFE,
    BATTERY_KWH,
    INVERTER_EFFICIENCY,
    SOC_DELTA_DENOM,
)


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


# ── SoH tests ──────────────────────────────────────────────────────────────

def test_soh_new_battery_is_one():
    assert soh(0.0, 0.0) == 1.0


def test_soh_calendar_only():
    # After 1 simulated year (365 days), calendar aging = 2% → SoH 0.98
    result = soh(365.0, 0.0)
    assert math.isclose(result, 0.98, rel_tol=1e-6)


def test_soh_cycle_only_at_eol():
    # After BATTERY_CYCLE_LIFE full cycles → cycle_fade = 20% → SoH 0.80
    full_cycle_kwh = BATTERY_CYCLE_LIFE * 2.0 * BATTERY_KWH
    result = soh(0.0, full_cycle_kwh)
    assert math.isclose(result, 0.80, rel_tol=1e-6)


def test_soh_combined_exceeds_floor():
    # Many years + many cycles should clamp at 0.70
    result = soh(10_000.0, 1_000_000.0)
    assert result == 0.70


def test_soh_decreases_with_usage():
    fresh = soh(0.0, 0.0)
    used = soh(100.0, 5000.0)
    assert used < fresh


# ── capacity conversions (one owner for the pack size) ───────────────────────

def test_throughput_kwh_ignores_the_direction():
    # charging and discharging both wear the cells
    assert throughput_kwh(10.0) == throughput_kwh(-10.0)
    assert math.isclose(throughput_kwh(10.0), BATTERY_KWH * 0.1)


def test_equivalent_cycles_counts_a_full_charge_plus_discharge():
    assert math.isclose(equivalent_cycles(2.0 * BATTERY_KWH), 1.0)
    assert equivalent_cycles(0.0) == 0.0


def test_capacity_conversions_follow_config(monkeypatch):
    """Both helpers have to track BATTERY_KWH rather than a literal.

    main() used to spell the pack size as 15.0 in three places, so changing
    BATTERY_KWH left its throughput and cycle counts disagreeing with soh().
    Patch the name bound in battery, not in config -- it imported it by value.
    """
    monkeypatch.setattr(battery, "BATTERY_KWH", 30.0)

    assert math.isclose(battery.throughput_kwh(100.0), 30.0)   # a full pass of the pack
    assert math.isclose(battery.equivalent_cycles(60.0), 1.0)  # 30 in + 30 out
