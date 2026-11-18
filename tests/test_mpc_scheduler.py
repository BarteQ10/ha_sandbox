"""MPC battery optimizer: the cost physics, the SoC guards, and what it decides.

solve() runs every simulated hour and its current_action drives the inverter, so
a wrong sign or a missing guard here moves real energy. The module had no tests
at all (16% covered, and that 16% was the imports), which is how the PRICE_SCALE
unit bug survived: costs came out 1000x too small, and because the accept
threshold in solve() is an absolute 0.001, the optimizer quietly refused every
move worth less than about a złoty.
"""
import numpy as np
import pytest

import ems_simulator.mpc_scheduler as mpc
from ems_simulator.battery import MODE_AUTO, MODE_FORCE_CHARGE, MODE_FORCE_DISCHARGE
from ems_simulator.pricing import distribution_rate

FLAT_PRICE = [50.0] * 24          # gr/kWh


def _forecast(pv=0.0, load=0.0, price=None):
    """A 24-hour forecast with constant pv/load (W) and a given price curve."""
    return {
        "pv": [pv] * 24,
        "load": [load] * 24,
        "price": list(price) if price is not None else list(FLAT_PRICE),
    }


# ── cost physics ──────────────────────────────────────────────────────────────

def test_import_costs_what_the_arithmetic_says():
    """2 kWh at 50 gr/kWh is 100 gr, i.e. 1.00 PLN — not 0.001."""
    # SoC pinned at the floor so nothing is available to discharge: the whole
    # 2 kW deficit for one hour is imported.
    _, cost = mpc._simulate(mpc.SOC_MIN, [0.0], [2000.0], [50.0], [MODE_AUTO],
                            step_h=1.0)
    assert cost == pytest.approx(1.0)


def test_surplus_charges_the_battery_and_imports_nothing():
    traj, cost = mpc._simulate(50.0, [3000.0] * 24, [1000.0] * 24, FLAT_PRICE,
                               [MODE_AUTO] * 24)
    assert cost == 0.0
    assert traj[0] > 50.0
    assert traj[-1] == pytest.approx(mpc.SOC_MAX)      # tops out at the cap, not 100%


def test_a_charged_battery_covers_a_deficit_for_free():
    traj, cost = mpc._simulate(90.0, [0.0], [2000.0], [50.0], [MODE_AUTO], step_h=1.0)
    assert cost == 0.0
    assert traj[0] < 90.0                              # it came out of the battery


def test_force_charge_is_capped_at_soc_max():
    traj, _ = mpc._simulate(mpc.SOC_MAX - 1.0, [0.0] * 3, [0.0] * 3, [10.0] * 3,
                            [MODE_FORCE_CHARGE] * 3)
    assert max(traj) == pytest.approx(mpc.SOC_MAX)


def test_force_discharge_is_floored_at_soc_min():
    traj, _ = mpc._simulate(mpc.SOC_MIN + 1.0, [0.0] * 3, [0.0] * 3, [99.0] * 3,
                            [MODE_FORCE_DISCHARGE] * 3)
    assert min(traj) == pytest.approx(mpc.SOC_MIN)


def test_force_charge_imports_the_charge_power_on_top_of_the_load():
    """1 kW load + 5 kW charging - 0 PV = 6 kWh imported for an hour."""
    _, cost = mpc._simulate(50.0, [0.0], [1000.0], [10.0], [MODE_FORCE_CHARGE],
                            step_h=1.0)
    assert cost == pytest.approx(6.0 * 10.0 / 100.0)   # 6 kWh at 10 gr/kWh = 0.60 PLN


# ── what solve() decides ──────────────────────────────────────────────────────

def test_a_truly_flat_cost_curve_leaves_everything_on_auto(monkeypatch):
    """No spread in what import actually costs: nothing to arbitrage."""
    monkeypatch.setattr(mpc, "distribution_rate", lambda h: 20)   # same every hour
    result = mpc.solve(50.0, _forecast(load=1000.0), current_hour=0)
    assert result.schedule == [MODE_AUTO] * 24
    assert result.savings == 0.0


def test_a_flat_energy_price_is_still_arbitraged_through_the_tariff():
    """The distribution rate is time-of-use (12 gr off-peak, 28 gr peak), so a
    flat RCE price is not a flat bill. Costing import at the energy price alone
    hid this spread completely."""
    result = mpc.solve(50.0, _forecast(load=1000.0), current_hour=0)

    charging = [h for h in range(24) if result.schedule[h] == MODE_FORCE_CHARGE]
    assert charging
    assert all(distribution_rate(h) == 12 for h in charging)   # only off-peak hours
    assert result.savings > 0


def test_the_distribution_tariff_is_actually_billed(monkeypatch):
    """naive_cost must include the tariff, the way loop_logic and backtest bill it."""
    fc = _forecast(load=2000.0)
    with_tariff = mpc.solve(50.0, fc, current_hour=0).naive_cost

    monkeypatch.setattr(mpc, "distribution_rate", lambda h: 0)
    energy_only = mpc.solve(50.0, fc, current_hour=0).naive_cost

    assert with_tariff > energy_only


def test_a_price_ladder_is_arbitraged_and_saves_money():
    """A curve with real spread across the quartiles: pre-charge cheap, save money."""
    price = [float(10 * (h + 1)) for h in range(24)]        # 10 → 240 gr/kWh
    result = mpc.solve(80.0, _forecast(load=500.0, price=price), current_hour=0)

    assert result.savings > 0
    assert result.cost_estimate < result.naive_cost
    assert MODE_FORCE_CHARGE in result.schedule
    # it charges in the cheap half of the day, not the expensive half
    charging = [h for h in range(24) if result.schedule[h] == MODE_FORCE_CHARGE]
    assert all(price[h] < float(np.percentile(price, 25)) for h in charging)


def test_a_two_tariff_night_rate_is_arbitraged():
    """The realistic shape the quartile pre-filter turned into a no-op.

    On a fixed two-tariff contract (G12 and friends) the whole night sits at one
    price. Eight tied hours is a third of the day, so the 25th percentile lands
    exactly on that night rate, and the old `price[h] >= p25` gate then excluded
    every single night hour from the charge branch — leaving the optimizer with
    nothing to do on a tariff whose entire point is cheap night energy.

    Spot RCE varies hour to hour and never degenerated like this, which is why
    it went unnoticed: the gate only collapses when hours tie at the minimum.
    """
    price = [40.0] * 6 + [80.0] * 16 + [40.0] * 2       # cheap 22:00-06:00
    pv = [0.0] * 6 + [2500.0] * 10 + [0.0] * 8
    load = [3000.0] * 24

    result = mpc.solve(70.0, {"pv": pv, "load": load, "price": price}, current_hour=0)

    charging = [h for h in range(24) if result.schedule[h] == MODE_FORCE_CHARGE]
    assert charging, "nothing scheduled on a tariff built around cheap night energy"
    # The cheap tier is where the energy has to come from. "Cheap" is the
    # *effective* price — energy plus that hour's distribution rate — so it
    # also covers the 13:00-15:00 distribution dip, which the energy price
    # alone cannot see.
    effective = [price[h] + distribution_rate(h) for h in range(24)]
    assert any(effective[h] == min(effective) for h in charging), \
        "nothing scheduled in the cheap tier"
    assert result.savings > 0
    # This used to assert that NO charge hour sat above the cheap tier. It can
    # now, legitimately: once the pack is nearly full a force-charge costs only
    # what still fits (_simulate caps it by the headroom), so the step is in
    # effect "hold, do not discharge into this hour" — a real strategy ahead of
    # a long peak, and one the cost model prices correctly. The guard that
    # matters is that the plan is cheaper than doing nothing, which is asserted
    # above and, for every curve, by test_it_never_returns_a_schedule_worse...
    assert result.savings > 0


def test_a_tie_heavy_cheap_window_is_arbitraged():
    """Same degeneracy, harsher: 19 of 24 hours tied at the minimum."""
    price = [20.0] * 19 + [200.0] * 5
    result = mpc.solve(80.0, _forecast(load=2000.0, price=price), current_hour=0)

    charging = [h for h in range(24) if result.schedule[h] == MODE_FORCE_CHARGE]
    assert charging, "nothing scheduled on the very shape this exists for"
    assert all(price[h] == 20.0 for h in charging)   # only in the cheap hours
    assert max(charging) < 19                        # and before the peak starts
    assert result.savings > 0
    assert result.cost_estimate < result.naive_cost


@pytest.mark.parametrize("price", [
    [20.0] * 19 + [200.0] * 5,                   # cheap night, evening peak
    [200.0] * 5 + [20.0] * 19,                   # the mirror image
    [20.0, 300.0] * 12,                          # alternating
    [float(10 * (h + 1)) for h in range(24)],    # ladder
    [50.0] * 24,                                 # no spread at all
])
@pytest.mark.parametrize("soc", [20.0, 50.0, 90.0])
def test_it_never_returns_a_schedule_worse_than_doing_nothing(price, soc):
    """The property that makes dropping the pre-filter safe: every move has to
    beat the current best by MIN_GAIN_PLN, so the result can only improve on
    plain auto mode — whatever the curve or the starting charge."""
    result = mpc.solve(soc, _forecast(pv=500.0, load=1500.0, price=price),
                       current_hour=0)
    assert result.cost_estimate <= result.naive_cost + 1e-9
    assert result.savings >= 0


def test_an_empty_battery_is_not_scheduled_to_discharge():
    price = [20.0] * 24
    price[18] = 200.0
    result = mpc.solve(mpc.SOC_MIN, _forecast(load=2000.0, price=price), current_hour=18)
    assert result.schedule[18] != MODE_FORCE_DISCHARGE


@pytest.mark.parametrize("hour", [0, 7, 18, 23, 26])
def test_current_action_is_the_first_hour_of_the_schedule(hour):
    """The forecast window starts at `current_hour`, so index 0 *is* now.
    Indexing by current_hour instead handed the inverter an action planned for
    current_hour hours into the future — at 14:00, the plan for 04:00 next day.
    """
    price = [20.0] * 24
    for h in range(17, 22):
        price[h] = 200.0

    result = mpc.solve(80.0, _forecast(load=2000.0, price=price), current_hour=hour)

    assert result.current_action == result.schedule[0]


def test_a_missing_forecast_is_treated_as_zeros_rather_than_crashing():
    result = mpc.solve(50.0, {}, current_hour=0)
    assert result.schedule == [MODE_AUTO] * 24
    assert result.cost_estimate == 0.0


# ── hourly vs quarter-hourly resolution ──────────────────────────────────────

def _quarterly(hourly_price):
    """The same physical price curve, sampled per quarter-hour."""
    return [p for p in hourly_price for _ in range(4)]


def test_the_same_curve_costs_the_same_at_either_resolution():
    """The invariant that catches a missed power-to-energy conversion: one
    forgotten step_h and the two resolutions would differ by 4x, not by the
    fraction of a percent that SoC clipping accounts for."""
    hourly = [float(10 * (h + 1)) for h in range(24)]
    fc24 = {"pv": [500.0] * 24, "load": [1500.0] * 24, "price": hourly}
    fc96 = {"pv": [500.0] * 96, "load": [1500.0] * 96, "price": _quarterly(hourly)}

    cost24 = mpc.solve(70.0, fc24, current_hour=0).naive_cost
    cost96 = mpc.solve(70.0, fc96, current_hour=0).naive_cost

    assert cost96 == pytest.approx(cost24, rel=0.02)


def test_the_schedule_comes_back_at_the_resolution_it_was_given():
    fc96 = {"pv": [0.0] * 96, "load": [1000.0] * 96, "price": [50.0] * 96}
    result = mpc.solve(50.0, fc96, current_hour=0)
    assert len(result.schedule) == 96
    assert result.current_action == result.schedule[0]


def test_the_quarterly_plan_holds_up_against_real_prices():
    """The reason for the whole change.

    Averaging a 15-minute price dip into its hour hides where the cheap energy
    actually is. Costed against the same real quarter prices, the plan made per
    quarter comes out cheaper than the one made on the hourly average — and it
    reports the larger saving honestly rather than by averaging.

    This only holds once the greedy search gets enough sweeps for the finer
    steps (PASSES_PER_24_STEPS); at three sweeps the quarterly plan was still
    half-built and cost more than the hourly one.
    """
    # A spike-and-dip hour: 03:00-03:15 is nearly free, the rest of hour 3 is
    # dear, and the hour's AVERAGE comes out the most expensive of the night —
    # so an hourly planner avoids the very hour holding the cheapest energy of
    # the day and settles for flat-60 hour 5 instead.
    #
    # The curve used to be a single cheap quarter on an otherwise flat 100.
    # That does not actually separate the two resolutions: a lone cheap quarter
    # drags its own hour's average down, so the hourly plan charges that hour
    # anyway and captures the dip too. Both plans then cost exactly the same.
    quarter_price = [100.0] * 96
    quarter_price[12:16] = [1.0, 200.0, 200.0, 200.0]   # hour 3: avg 150.25
    quarter_price[20:24] = [60.0] * 4                   # hour 5: flat, looks cheapest
    hourly_price = [sum(quarter_price[h * 4:(h + 1) * 4]) / 4 for h in range(24)]
    pv, load = [0.0] * 96, [3000.0] * 96

    per_quarter = mpc.solve(60.0, {"pv": pv, "load": load, "price": quarter_price},
                            current_hour=0)
    per_hour = mpc.solve(60.0, {"pv": pv[:24], "load": load[:24], "price": hourly_price},
                         current_hour=0)

    # Cost both plans against the SAME real quarter-resolution prices.
    effective = [p + distribution_rate((i * 0.25) % 24)
                 for i, p in enumerate(quarter_price)]
    _, real_cost_quarterly = mpc._simulate(
        60.0, pv, load, effective, per_quarter.schedule, step_h=0.25)
    _, real_cost_hourly = mpc._simulate(
        60.0, pv, load, effective, [a for a in per_hour.schedule for _ in range(4)],
        step_h=0.25)

    assert real_cost_quarterly < real_cost_hourly
    assert per_quarter.savings > per_hour.savings


def test_the_schedule_always_covers_24_hours():
    result = mpc.solve(50.0, _forecast(load=1000.0, price=[10.0, 90.0] * 12),
                       current_hour=0)
    assert len(result.schedule) == 24


# ── the cost model respects the SoC limits it clamps to ──────────────────────

def test_a_discharge_the_battery_cannot_sustain_is_billed_for_the_shortfall():
    """At 31% SoC a one-hour 5 kW discharge needs ~36% of a 15 kWh pack.

    _simulate used to clamp SoC at SOC_MIN but bill the step as though the full
    DISCHARGE_KW had flowed for its whole length, so the hour came out FREE.
    solve() accepts a move on the cost it is quoted, so every `savings` figure
    that reached InfluxDB and the dashboard was inflated by that shortfall.
    """
    traj, cost = mpc._simulate(31.0, [0.0], [5000.0], [100.0],
                               [MODE_FORCE_DISCHARGE], 15.0, 1.0)

    assert traj[0] == pytest.approx(mpc.SOC_MIN)             # the pack ran dry
    from_pack = (31.0 - mpc.SOC_MIN) / 100.0 * 15.0          # 1.65 kWh available
    delivered = from_pack * mpc.EFFICIENCY                   # 1.52 kWh reaches the house
    shortfall = 5.0 - delivered                              # the rest is imported
    assert cost == pytest.approx(shortfall * 100.0 / mpc.PRICE_SCALE)
    assert cost > 0


def test_a_discharge_the_battery_can_sustain_is_priced_as_before():
    """The cap must only bite when it has to: 5 kWh out of a 90% pack is fine."""
    _, cost = mpc._simulate(90.0, [0.0], [5000.0], [100.0],
                            [MODE_FORCE_DISCHARGE], 15.0, 1.0)
    assert cost == pytest.approx(0.0)


def test_a_charge_near_full_only_pays_for_the_energy_that_fits():
    """The mirror image: billing the full CHARGE_KW overstated a top-up.

    At 88% SoC only 0.3 kWh of the pack is left to fill, so that — plus its
    conversion loss — is what the meter sees, not a full 5 kWh.
    """
    _, cost = mpc._simulate(88.0, [0.0], [0.0], [100.0],
                            [MODE_FORCE_CHARGE], 15.0, 1.0)

    into_pack = (mpc.SOC_MAX - 88.0) / 100.0 * 15.0          # 0.3 kWh
    off_the_meter = into_pack / mpc.EFFICIENCY               # 0.326 kWh
    assert cost == pytest.approx(off_the_meter * 100.0 / mpc.PRICE_SCALE)


def test_a_charge_with_room_to_spare_is_priced_as_before():
    """1 kW load + 5 kW charging - 0 PV = 6 kWh for an hour, as it always was."""
    _, cost = mpc._simulate(50.0, [0.0], [1000.0], [10.0],
                            [MODE_FORCE_CHARGE], 15.0, 1.0)
    assert cost == pytest.approx(6.0 * 10.0 / mpc.PRICE_SCALE)
