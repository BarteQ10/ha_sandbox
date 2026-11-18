"""Open-Meteo parsing, caching and the fallbacks around it.

GHI from here drives PV output, so a misparse would quietly distort the whole
simulation rather than fail. The module was 20% covered: everything except the
import block went untested, including the rule that a failed refresh must not
throw away the good data already cached.
"""
import datetime

import pytest

import ems_simulator.weather as weather


def _payload(hours=3, start="2026-11-15T00:00"):
    """An Open-Meteo-shaped response with distinguishable values per hour."""
    t0 = datetime.datetime.fromisoformat(start)
    return {
        "hourly": {
            "time": [(t0 + datetime.timedelta(hours=i)).isoformat() for i in range(hours)],
            "shortwave_radiation": [100.0 * i for i in range(hours)],
            "temperature_2m": [10.0 + i for i in range(hours)],
            "cloud_cover": [5.0 * i for i in range(hours)],
        }
    }


@pytest.fixture(autouse=True)
def _clean_module_state(monkeypatch):
    """Each test starts with empty caches; nothing leaks into the next."""
    monkeypatch.setattr(weather, "_cache", {})
    monkeypatch.setattr(weather, "_forecast_rows", [])
    monkeypatch.setattr(weather, "_last_refresh", -1)


# ── parsing ───────────────────────────────────────────────────────────────────

def test_parse_rows_keeps_each_hour_with_its_own_values():
    """The three arrays are indexed in parallel — a shift here would pair the
    wrong GHI with the wrong hour, and nothing downstream would notice."""
    rows = weather._parse_rows(_payload(hours=3))

    assert len(rows) == 3
    assert [r["ghi"] for r in rows] == [0.0, 100.0, 200.0]
    assert [r["temp"] for r in rows] == [10.0, 11.0, 12.0]
    assert [r["cloud"] for r in rows] == [0.0, 5.0, 10.0]
    assert rows[1]["ds"] == datetime.datetime(2026, 11, 15, 1, 0)
    assert all(isinstance(r["ds"], datetime.datetime) for r in rows)


def test_parse_rows_on_an_empty_series():
    assert weather._parse_rows({"hourly": {"time": [], "shortwave_radiation": [],
                                           "temperature_2m": [], "cloud_cover": []}}) == []


# ── fetch + cache ─────────────────────────────────────────────────────────────

def test_fetch_fills_the_cache_keyed_by_date_and_hour(monkeypatch):
    today = datetime.date.today()
    monkeypatch.setattr(weather, "get_json",
                        lambda *a, **k: _payload(hours=2, start=f"{today}T00:00"))

    weather.fetch()

    assert weather._cache[(today, 1)] == {"ghi": 100.0, "temp": 11.0, "cloud": 5.0}
    assert len(weather._forecast_rows) == 2


def test_a_failed_fetch_keeps_the_data_already_cached(monkeypatch):
    """A transient API failure must degrade to stale data, not to no data."""
    today = datetime.date.today()
    monkeypatch.setattr(weather, "get_json",
                        lambda *a, **k: _payload(hours=2, start=f"{today}T00:00"))
    weather.fetch()
    good_cache = dict(weather._cache)

    def _boom(*a, **k):
        raise ConnectionError("open-meteo down")

    monkeypatch.setattr(weather, "get_json", _boom)
    weather.fetch()          # must not raise

    assert weather._cache == good_cache
    assert len(weather._forecast_rows) == 2


def test_get_returns_the_cached_triple_and_wraps_the_hour(monkeypatch):
    today = datetime.date.today()
    monkeypatch.setattr(weather, "_cache",
                        {(today, 3): {"ghi": 42.0, "temp": 7.5, "cloud": 80.0}})

    assert weather.get(3) == (42.0, 7.5, 80.0)
    assert weather.get(27) == (42.0, 7.5, 80.0)     # 27 % 24 == 3
    assert weather.get(4) == (None, None, None)     # nothing cached for that hour


def test_get_on_an_empty_cache_is_all_none():
    assert weather.get(12) == (None, None, None)


# ── refresh scheduling ────────────────────────────────────────────────────────

def test_needs_refresh_fires_once_per_hour_on_the_tick_boundary():
    assert weather.needs_refresh(5, day_step=24) is True    # new hour, boundary tick
    assert weather.needs_refresh(5, day_step=36) is False   # same hour again
    assert weather.needs_refresh(6, day_step=48) is True    # next hour


def test_needs_refresh_ignores_ticks_off_the_boundary():
    assert weather.needs_refresh(5, day_step=25) is False


# ── the three dataframe helpers degrade to [] ─────────────────────────────────

@pytest.mark.parametrize("call", [
    lambda: weather.archive_df("2026-01-01", "2026-01-02"),
    lambda: weather.ml_forecast_df(past_days=3),
    lambda: weather.forecast_df(),
])
def test_dataframe_helpers_return_empty_on_failure(monkeypatch, call):
    """Callers treat [] as "no data" and fall back; an exception would kill the tick."""
    def _boom(*a, **k):
        raise ConnectionError("down")

    monkeypatch.setattr(weather, "get_json", _boom)
    assert call() == []


def test_forecast_df_serves_the_cache_without_calling_out(monkeypatch):
    """It is called every tick by the forecaster, so a cache hit must not do HTTP."""
    monkeypatch.setattr(weather, "_forecast_rows", [{"ds": "x", "ghi": 1}])

    def _must_not_be_called(*a, **k):
        raise AssertionError("forecast_df hit the network despite a warm cache")

    monkeypatch.setattr(weather, "get_json", _must_not_be_called)

    assert weather.forecast_df() == [{"ds": "x", "ghi": 1}]


def test_ml_forecast_df_asks_for_the_requested_history(monkeypatch):
    seen = {}

    def _capture(url, **k):
        seen["url"] = url
        return _payload(hours=1)

    monkeypatch.setattr(weather, "get_json", _capture)
    weather.ml_forecast_df(past_days=9)

    assert "past_days=9" in seen["url"]
