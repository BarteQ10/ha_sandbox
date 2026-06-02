from ems_simulator.advisor import DEFAULT_APPLIANCES, recommend


def _hours(prices, pv=None):
    pv = pv or [0] * len(prices)
    return [{"hour": h, "price_gr": prices[h], "pv_w": pv[h]} for h in range(len(prices))]


def test_empty_hours_returns_empty():
    assert recommend([], DEFAULT_APPLIANCES, 0) == []


def test_picks_cheapest_window():
    # cheap at hour 3, expensive elsewhere
    prices = [50] * 24
    prices[3] = 5
    recs = recommend(_hours(prices), [{"name": "x", "power_w": 1000, "duration_h": 1}], now_hour=0)
    assert recs[0]["best_hour"] == 3
    assert recs[0]["cost_gr"] == 5   # 1 kWh × 5 gr


def test_pv_offsets_cost_and_is_preferred():
    # uniform price, but hour 10 has PV >= load → free
    prices = [40] * 24
    pv = [0] * 24
    pv[10] = 1500
    recs = recommend(_hours(prices, pv), [{"name": "x", "power_w": 1000, "duration_h": 1}], now_hour=0)
    assert recs[0]["best_hour"] == 10
    assert recs[0]["cost_gr"] == 0   # PV covers the whole load


def test_saving_vs_now():
    prices = [50] * 24
    prices[6] = 10
    recs = recommend(_hours(prices), [{"name": "x", "power_w": 1000, "duration_h": 1}], now_hour=0)
    r = recs[0]
    # now (hour 0) costs 50 gr, best (hour 6) costs 10 gr → saving 40
    assert r["cost_now_gr"] == 50
    assert r["cost_gr"] == 10
    assert r["saving_gr"] == 40


def test_multi_hour_window_wraps():
    prices = [50] * 24
    # cheapest 2h block straddles midnight (23, 0)
    prices[23] = 1
    prices[0] = 1
    recs = recommend(_hours(prices), [{"name": "x", "power_w": 1000, "duration_h": 2}], now_hour=12)
    assert recs[0]["best_hour"] == 23
    assert recs[0]["cost_gr"] == 2
