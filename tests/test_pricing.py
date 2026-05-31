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


def test_max_today_uses_cached_list(monkeypatch):
    monkeypatch.setattr(pricing, "_price_cache", [100.0, None, 250.0])
    assert pricing.max_today() == 25.0  # 250 PLN/MWh -> 25 gr/kWh
