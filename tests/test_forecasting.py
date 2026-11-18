"""Forecast price fallback: real RCE prices before synthetic ones.

predict_next_24h() always returns a "price" list, and the charge scheduler and
the MPC solver consume it on every hourly recompute. With an unfitted price
model -- the state on every fresh start, before InfluxDB has a day of history
-- it used to fill all 24 hours with random band prices even when
pricing.fetch() had already pulled the real RCE curve into memory.
"""
import pytest

import ems_simulator.pricing as pricing
import ems_simulator.weather as weather
from ems_simulator.forecasting import ForecastEngine


@pytest.fixture
def engine(monkeypatch):
    # Empty weather cache -> _weather_future_df() uses its offline 24-row
    # fallback, so no HTTP call and exactly one row per hour of day.
    monkeypatch.setattr(weather, "forecast_df", lambda: [])
    return ForecastEngine()


def test_unfitted_price_model_uses_live_rce(engine, monkeypatch):
    monkeypatch.setattr(pricing, "_price_cache", [500.0] * pricing.PERIODS_PER_DAY)

    fc = engine.predict_next_24h()

    # One sample per quarter-hour settlement period, which is what PSE publishes.
    assert len(fc["price"]) == pricing.PERIODS_PER_DAY
    assert len(fc["pv"]) == len(fc["load"]) == pricing.PERIODS_PER_DAY
    assert fc["price"] == [50.0] * pricing.PERIODS_PER_DAY   # 500 PLN/MWh -> 50 gr/kWh


def test_unfitted_price_model_synthesizes_only_missing_hours(engine, monkeypatch):
    cache: list = [500.0] * pricing.PERIODS_PER_DAY
    for q in range(pricing.PERIODS_PER_HOUR):  # PSE had no data for 03:00-04:00
        cache[3 * pricing.PERIODS_PER_HOUR + q] = None
    monkeypatch.setattr(pricing, "_price_cache", cache)
    monkeypatch.setattr(pricing, "fallback_price", lambda h: 999)

    fc = engine.predict_next_24h()

    assert fc["price"].count(50.0) == pricing.PERIODS_PER_DAY - pricing.PERIODS_PER_HOUR
    assert fc["price"].count(999.0) == pricing.PERIODS_PER_HOUR


@pytest.mark.parametrize("samples", [24, pricing.PERIODS_PER_DAY])
def test_summary_energy_does_not_depend_on_the_sampling(engine, samples):
    """1 kW held across a day is 24 kWh however finely it is sampled — the guard
    against reporting 4x the energy once the arrays went quarter-hourly."""
    forecast = {"pv": [1000.0] * samples, "load": [500.0] * samples,
                "price": [50.0] * samples}

    s = engine.summary(forecast)

    assert s["pv_day_kwh"] == 24.0
    assert s["load_day_kwh"] == 12.0
    assert s["price_avg"] == 50.0


def test_pv_is_held_flat_across_each_hours_periods(engine, monkeypatch):
    """The weather feeding the PV model is hourly, so PV is held across its four
    periods rather than invented at a finer resolution — unlike the price, which
    PSE really does publish per quarter."""
    monkeypatch.setattr(pricing, "_price_cache", [500.0] * pricing.PERIODS_PER_DAY)

    pv = engine.predict_next_24h()["pv"]

    for h in range(24):
        row = pv[h * pricing.PERIODS_PER_HOUR:(h + 1) * pricing.PERIODS_PER_HOUR]
        assert len(set(row)) == 1, f"hour {h} varies within the hour: {row}"


def test_price_curve_covers_every_hour_of_day(engine, monkeypatch):
    """Each hour-of-day appears once, now as its four settlement periods."""
    monkeypatch.setattr(pricing, "_price_cache",
                        [float(h * 10) for h in range(24)
                         for _ in range(pricing.PERIODS_PER_HOUR)])

    fc = engine.predict_next_24h()

    assert sorted(fc["price"]) == sorted(
        [float(h) for h in range(24)] * pricing.PERIODS_PER_HOUR)
