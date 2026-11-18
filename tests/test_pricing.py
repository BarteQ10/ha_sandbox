import datetime

import ems_simulator.pricing as pricing
from ems_simulator.config import PRICE_BANDS

BAND_PEAK = float(max(hi for _, _, _, hi in PRICE_BANDS))


def _seed_cache(monkeypatch, cache, day=None):
    """Install `cache` as the prices for `day` (today by default).

    The date has to be patched alongside the list: the cache is only served for
    the day it was fetched for, so a cache without a matching date counts as
    yesterday's and is ignored. Patching both also keeps the module state from
    leaking into the next test.
    """
    monkeypatch.setattr(pricing, "_price_cache", cache)
    monkeypatch.setattr(pricing, "_cache_date", day or datetime.date.today())


def test_distribution_rate_zones():
    assert pricing.distribution_rate(0) == 12    # off-peak night
    assert pricing.distribution_rate(8) == 28    # morning peak
    assert pricing.distribution_rate(14) == 12   # midday dip
    assert pricing.distribution_rate(20) == 28   # evening peak
    assert pricing.distribution_rate(23) == 12   # late off-peak


def test_distribution_rate_wraps_hour():
    assert pricing.distribution_rate(24) == pricing.distribution_rate(0)


def test_fallback_price_in_band_range():
    for lo_h, _hi_h, lo_p, hi_p in PRICE_BANDS:
        h = lo_h
        p = pricing.fallback_price(h)
        assert lo_p <= p <= hi_p


def test_max_today_falls_back_to_band_peak(monkeypatch):
    monkeypatch.setattr(pricing, "_price_cache", [])
    expected = max(hi for _, _, _, hi in PRICE_BANDS)
    assert pricing.max_today() == float(expected)


def _quarters(per_hour_prices):
    """96-slot PLN/MWh cache from 24 hourly values."""
    return [p for p in per_hour_prices for _ in range(pricing.PERIODS_PER_HOUR)]


def test_period_index_uses_the_fractional_hour():
    """main's loop passes day_step / STEPS_PER_HOUR, so 13.25 is 13:15 — that
    fraction picks the settlement period instead of being dropped by int()."""
    assert pricing.period_index(0) == 0
    assert pricing.period_index(13) == 52
    assert pricing.period_index(13.25) == 53
    assert pricing.period_index(13.5) == 54
    assert pricing.period_index(13.75) == 55
    assert pricing.period_index(23.99) == 95
    assert pricing.period_index(24.5) == 2      # wraps


def test_get_returns_the_price_of_that_quarter(monkeypatch):
    cache = [1000.0] * pricing.PERIODS_PER_DAY
    cache[53] = 200.0                            # 13:15-13:30 only
    _seed_cache(monkeypatch, cache)

    assert pricing.get(13) == 100.0              # 13:00 quarter
    assert pricing.get(13.25) == 20.0            # the cheap quarter
    assert pricing.get(13.5) == 100.0


def test_hour_average_spans_the_whole_hour(monkeypatch):
    cache = [1000.0] * pricing.PERIODS_PER_DAY
    cache[52] = 0.0                              # one cheap quarter in hour 13
    _seed_cache(monkeypatch, cache)

    # (0 + 1000 + 1000 + 1000) / 4 = 750 PLN/MWh -> 75 gr/kWh
    assert pricing.hour_average(13) == 75.0
    assert pricing.hour_average(37) == 75.0      # wraps
    assert pricing.hour_average(5) == 100.0


def test_hour_average_is_none_without_data(monkeypatch):
    monkeypatch.setattr(pricing, "_price_cache", [])
    assert pricing.hour_average(5) is None


def test_fetch_keeps_quarter_resolution(monkeypatch):
    """The spread *within* an hour is where a lot of the arbitrage sits, and it
    is the resolution the market bills at — averaging it away lost both."""
    today = datetime.date.today().isoformat()
    entries = []
    for h in range(24):
        for q, minute in enumerate((0, 15, 30, 45)):
            entries.append({"dtime": f"{today} {h:02d}:{minute:02d}:00",
                            "rce_pln": 100.0 + q})      # 100, 101, 102, 103
    monkeypatch.setattr(pricing, "get_json", lambda *a, **k: {"value": entries})
    _seed_cache(monkeypatch, [])

    pricing.fetch()

    assert len(pricing._price_cache) == pricing.PERIODS_PER_DAY
    assert pricing._price_cache[:4] == [100.0, 101.0, 102.0, 103.0]
    assert pricing.get(0) == 10.0            # the :00 quarter, not the average
    assert pricing.hour_average(0) == 10.15  # (100+101+102+103)/4/10


def test_max_today_uses_cached_list(monkeypatch):
    _seed_cache(monkeypatch, _quarters([100.0, None, 250.0]))
    assert pricing.max_today() == 25.0  # 250 PLN/MWh -> 25 gr/kWh


# ── the cache is only valid for the day it was fetched for ───────────────────

def test_yesterdays_cache_is_not_served_as_todays_prices(monkeypatch):
    """The cache holds exactly one day.

    Yesterday's values are not None, so without a date check every reader
    served them as today's and the synthetic fallback never ran -- one failed
    fetch at midnight mispriced a whole simulated day.
    """
    yesterday = datetime.date.today() - datetime.timedelta(days=1)
    _seed_cache(monkeypatch, [1000.0] * pricing.PERIODS_PER_DAY, day=yesterday)

    assert pricing.get(13) is None
    assert pricing.hour_average(13) is None
    assert pricing.max_today() == BAND_PEAK     # falls back to the synthetic band


def test_fetch_records_the_day_it_fetched_for(monkeypatch):
    today = datetime.date.today()
    entries = [{"dtime": f"{today.isoformat()} 00:00:00", "rce_pln": 100.0}]
    monkeypatch.setattr(pricing, "get_json", lambda *a, **k: {"value": entries})
    monkeypatch.setattr(pricing, "_price_cache", [])
    monkeypatch.setattr(pricing, "_cache_date", None)   # nothing fetched yet

    pricing.fetch()

    assert pricing._cache_date == today
    assert pricing.get(0) == 10.0


def test_a_failed_fetch_after_midnight_drops_yesterdays_cache(monkeypatch):
    """A fetch that fails must leave readers with nothing, not with yesterday."""
    yesterday = datetime.date.today() - datetime.timedelta(days=1)
    _seed_cache(monkeypatch, [1000.0] * pricing.PERIODS_PER_DAY, day=yesterday)

    def _boom(*_a, **_k):
        raise RuntimeError("PSE is down")

    monkeypatch.setattr(pricing, "get_json", _boom)

    pricing.fetch()

    assert pricing._price_cache == []
    assert pricing._cache_date is None
    assert pricing.get(13) is None


def test_a_failed_fetch_on_the_same_day_keeps_the_cache(monkeypatch):
    """Only a date rollover invalidates it -- a blip must not lose today's prices."""
    _seed_cache(monkeypatch, [1000.0] * pricing.PERIODS_PER_DAY)

    def _boom(*_a, **_k):
        raise RuntimeError("PSE is down")

    monkeypatch.setattr(pricing, "get_json", _boom)

    pricing.fetch()

    assert pricing.get(13) == 100.0
