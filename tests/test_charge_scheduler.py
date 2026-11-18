"""Charge-window scheduler: where prices come from, and which window wins.

The scheduler used to take the price cache as an argument. main.py bound that
argument once at import time (`from pricing import _price_cache as p_cache`),
but pricing.fetch() rebinds the module global instead of mutating it, so the
argument stayed empty forever and every hour got a random synthetic price.
These tests pin the live lookup that replaced the argument.
"""
import datetime

import pytest

import ems_simulator.charge_scheduler as cs
import ems_simulator.pricing as pricing
from ems_simulator.charge_scheduler import compute_charge_window
from ems_simulator.config import PRICE_BANDS

NIGHT_HOURS = list(range(22, 24)) + list(range(0, 8))


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Guard: no test here may reach the weather API."""
    monkeypatch.setattr(cs, "forecast_df", lambda: [])


def _cache(cheap_hours=(), cheap=1.0, dear=1000.0):
    """96-slot PLN/MWh cache — four quarter-hour settlement periods per hour:
    `cheap` for every period of cheap_hours, `dear` everywhere else."""
    cache = [dear] * pricing.PERIODS_PER_DAY
    for h in cheap_hours:
        for q in range(pricing.PERIODS_PER_HOUR):
            cache[h * pricing.PERIODS_PER_HOUR + q] = cheap
    return cache


def _fc_price(start_hour, cheap_hours, cheap=1.0, dear=100.0):
    """A forecast price list in the module's own convention: index i is the
    price for hour (start_hour + i) % 24, because the window starts at "now"."""
    return [cheap if (start_hour + i) % 24 in cheap_hours else dear for i in range(24)]


def _pse_payload(price):
    """A full day of PSE quarter-hour records, all at the same price."""
    today = datetime.date.today().isoformat()
    return {"value": [
        {"dtime": f"{today} {h:02d}:{m:02d}:00", "rce_pln": price}
        for h in range(24) for m in (0, 15, 30, 45)
    ]}


def test_price_at_hour_uses_live_rce(monkeypatch):
    monkeypatch.setattr(pricing, "_price_cache", _cache(cheap_hours=[3], cheap=240.0))
    assert cs._price_at_hour(3) == 24.0        # 240 PLN/MWh -> 24 gr/kWh


def test_price_at_hour_wraps_and_synthesizes_missing_hours(monkeypatch):
    monkeypatch.setattr(pricing, "_price_cache", [])
    for lo_h, _hi_h, lo_p, hi_p in PRICE_BANDS:
        assert lo_p <= cs._price_at_hour(lo_h + 24) <= hi_p


def test_price_at_hour_sees_prices_fetched_after_import(monkeypatch):
    """The regression: fetch() rebinds the cache, so the lookup must be late."""
    monkeypatch.setattr(pricing, "_price_cache", [])
    monkeypatch.setattr(pricing, "get_json", lambda *a, **k: _pse_payload(300.0))

    pricing.fetch()                            # rebinds pricing._price_cache

    assert cs._price_at_hour(3) == 30.0        # 300 PLN/MWh -> 30 gr/kWh


def test_window_prefers_cheapest_live_hours(monkeypatch):
    monkeypatch.setattr(pricing, "_price_cache", _cache(cheap_hours=(3, 4, 5)))

    start, duration, energy, pv_kwh = compute_charge_window(
        22, 20.0, forecast={"pv": [0.0] * 24}
    )

    assert (energy, duration) == (10.5, 3)     # 13.5 - 3.0 kWh at 5 kW
    assert start == 3
    assert pv_kwh == 0.0


def test_window_uses_the_forecast_curve_when_it_is_complete(monkeypatch):
    monkeypatch.setattr(pricing, "_price_cache", _cache(cheap_hours=(3, 4, 5)))

    start, _, _, _ = compute_charge_window(
        22, 20.0, forecast={"pv": [0.0] * 24, "price": _fc_price(22, {5, 6, 7})}
    )

    assert start == 5       # the forecast curve wins over the live cache


@pytest.mark.parametrize("now", [0, 9, 17, 22])
def test_the_forecast_curve_is_read_at_the_right_offset(monkeypatch, now):
    """A forecast starts at `hour`, not at midnight, so hour-of-day h sits at
    offset (h - hour). Indexing it by h read a curve rotated by the current
    hour, which put the charge window on whatever hours happened to sit at
    those offsets — a different answer at every hour of the day."""
    monkeypatch.setattr(pricing, "_price_cache", [])        # no live prices
    cheap = {2, 3, 4}

    start, duration, _, _ = compute_charge_window(
        now, 20.0, forecast={"pv": [0.0] * 24, "price": _fc_price(now, cheap)}
    )

    assert duration == 3
    assert start == 2, f"called at hour {now}, the window slid to {start}"


def test_window_ignores_a_short_forecast_price_list(monkeypatch):
    """A truncated price list used to be indexed past its end (IndexError)."""
    monkeypatch.setattr(pricing, "_price_cache", _cache(cheap_hours=(3, 4, 5)))

    start, _, _, _ = compute_charge_window(
        22, 20.0, forecast={"pv": [0.0] * 24, "price": [5.0, 6.0]}
    )

    assert start == 3       # fell back to the live cache instead of crashing


def _tiered_cache():
    """Live prices (gr/kWh) where the energy-only cheapest window is 05-08, but
    06:00 and 07:00 carry the 28 gr distribution rate instead of 12.

        hours 6,7   ->   1 gr energy   (cheapest on energy alone)
        hours 3,4,5 ->  10 gr energy
        everything else 100 gr
    """
    cache = [1000.0] * pricing.PERIODS_PER_DAY     # pricing divides by 10
    for h in (3, 4, 5):
        for q in range(pricing.PERIODS_PER_HOUR):
            cache[h * pricing.PERIODS_PER_HOUR + q] = 100.0
    for h in (6, 7):
        for q in range(pricing.PERIODS_PER_HOUR):
            cache[h * pricing.PERIODS_PER_HOUR + q] = 10.0
    return cache


def test_the_window_pays_the_distribution_tariff(monkeypatch):
    """Charging from the grid is an import and is billed the hourly tariff.
    On energy alone 05-08 looks cheapest (10+1+1); once the 28 gr peak rate
    after 06:00 is counted, 03-06 at the 12 gr off-peak rate wins instead."""
    monkeypatch.setattr(pricing, "_price_cache", _tiered_cache())

    start, duration, _, _ = compute_charge_window(22, 20.0, forecast={"pv": [0.0] * 24})

    assert duration == 3
    assert start == 3          # 03,04,05 — all before the 06:00 rate change


def test_without_the_tariff_the_window_follows_the_energy_price_alone(monkeypatch):
    """The other half of the pair: zero the tariff and the choice flips back,
    which is what shows the tariff is doing the work above."""
    monkeypatch.setattr(pricing, "_price_cache", _tiered_cache())
    monkeypatch.setattr(cs, "distribution_rate", lambda h: 0)

    start, _, _, _ = compute_charge_window(22, 20.0, forecast={"pv": [0.0] * 24})

    assert start == 5          # 05,06,07 — cheapest on energy, dearest on tariff


@pytest.mark.parametrize("samples", [24, 96])
def test_tomorrows_pv_energy_is_the_same_at_either_resolution(monkeypatch, samples):
    """1 kW held across a day is 24 kWh however finely it is sampled. Summing 96
    quarter-hour samples as if hourly would have claimed 96."""
    monkeypatch.setattr(pricing, "_price_cache", _cache(cheap_hours=(3, 4, 5)))

    _, _, _, pv_kwh = compute_charge_window(
        22, 20.0, forecast={"pv": [1000.0] * samples})

    assert pv_kwh == 24.0


def test_a_quarter_resolution_forecast_is_read_at_the_right_offset(monkeypatch):
    """96 samples span the same day, so hour-of-day h is 4*(h-hour) samples in.
    Reading it by hour would have covered only the first 6 hours of the window."""
    monkeypatch.setattr(pricing, "_price_cache", [])
    price = [100.0] * 96
    for i in range(96):                      # cheap at hours 2,3,4 of the day
        if (22 + i / 4) % 24 in (2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.75,
                                 4.0, 4.25, 4.5, 4.75):
            price[i] = 1.0

    start, duration, _, _ = compute_charge_window(
        22, 20.0, forecast={"pv": [0.0] * 96, "price": price})

    assert (start, duration) == (2, 3)


def test_each_night_hour_is_priced_once(monkeypatch):
    """Hours with no data get a random band price, so pricing an hour again for
    every window it appears in made the window costs incomparable."""
    monkeypatch.setattr(pricing, "_price_cache", [])
    seen = []

    def _counted(h):
        seen.append(h)
        return 10

    monkeypatch.setattr(cs, "fallback_price", _counted)

    compute_charge_window(22, 20.0, forecast={"pv": [0.0] * 24})

    assert sorted(seen) == sorted(NIGHT_HOURS)   # 10 calls, not 24
