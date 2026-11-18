import ems_simulator.pricing as pricing
from ems_simulator.config import PRICE_BANDS


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
    monkeypatch.setattr(pricing, "_price_cache", cache)

    assert pricing.get(13) == 100.0              # 13:00 quarter
    assert pricing.get(13.25) == 20.0            # the cheap quarter
    assert pricing.get(13.5) == 100.0


def test_hour_average_spans_the_whole_hour(monkeypatch):
    cache = [1000.0] * pricing.PERIODS_PER_DAY
    cache[52] = 0.0                              # one cheap quarter in hour 13
    monkeypatch.setattr(pricing, "_price_cache", cache)

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
    today = __import__("datetime").date.today().isoformat()
    entries = []
    for h in range(24):
        for q, minute in enumerate((0, 15, 30, 45)):
            entries.append({"dtime": f"{today} {h:02d}:{minute:02d}:00",
                            "rce_pln": 100.0 + q})      # 100, 101, 102, 103
    monkeypatch.setattr(pricing, "get_json", lambda *a, **k: {"value": entries})
    monkeypatch.setattr(pricing, "_price_cache", [])

    pricing.fetch()

    assert len(pricing._price_cache) == pricing.PERIODS_PER_DAY
    assert pricing._price_cache[:4] == [100.0, 101.0, 102.0, 103.0]
    assert pricing.get(0) == 10.0            # the :00 quarter, not the average
    assert pricing.hour_average(0) == 10.15  # (100+101+102+103)/4/10


def test_max_today_uses_cached_list(monkeypatch):
    monkeypatch.setattr(pricing, "_price_cache", _quarters([100.0, None, 250.0]))
    assert pricing.max_today() == 25.0  # 250 PLN/MWh -> 25 gr/kWh
