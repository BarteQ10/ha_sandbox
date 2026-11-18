import pandas as pd
import pytest

import backtest


def _synthetic_df(hours=48):
    """Build a deterministic hourly DataFrame like load_history() returns."""
    ts = pd.date_range("2026-05-24", periods=hours, freq="1h")
    rows = []
    for t in ts:
        h = t.hour
        pv = 4000 if 9 <= h <= 16 else 0          # daytime PV
        load = 800 if 6 <= h <= 22 else 300        # day/night load
        price = 60 if 17 <= h <= 21 else 20        # evening peak
        rows.append({"ds": t, "pv_w": pv, "load_w": load, "price_gr": price, "hour": h})
    return pd.DataFrame(rows)


def test_baseline_cost_is_in_zloty_not_in_thousandths():
    """1 kWh imported at 50 gr/kWh plus the 12 gr night distribution rate is
    62 gr = 0.62 PLN. PRICE_SCALE used to be the Wh denominator while the energy
    here is kWh, so every reported cost came out 1000x too small."""
    one_hour = pd.DataFrame([{
        "ds": pd.Timestamp("2026-05-24 00:00"), "pv_w": 0, "load_w": 1000,
        "price_gr": 50, "hour": 0,
    }])

    result = backtest.strategy_baseline(one_hour)

    assert result.cost_pln == pytest.approx(0.62)


def test_run_backtest_no_data(monkeypatch):
    monkeypatch.setattr(backtest, "load_history", lambda days: pd.DataFrame())
    result = backtest.run_backtest(7)
    assert result["error"] == "no_data"
    assert result["days"] == 7


def test_run_backtest_shape(monkeypatch):
    monkeypatch.setattr(backtest, "load_history", lambda days: _synthetic_df())
    result = backtest.run_backtest(2)

    assert set(result.keys()) >= {
        "days", "rows", "from", "to", "strategies", "best",
        "savings_pln", "savings_year_est", "timeline",
    }
    assert result["rows"] == 48
    assert len(result["strategies"]) == 4
    assert len(result["timeline"]) == 48


def test_run_backtest_strategy_fields(monkeypatch):
    monkeypatch.setattr(backtest, "load_history", lambda days: _synthetic_df())
    result = backtest.run_backtest(2)
    for s in result["strategies"]:
        assert set(s.keys()) == {
            "name", "cost_pln", "savings_pct", "import_kwh", "export_kwh",
            "self_sufficiency", "charge_cycles", "cumulative_cost",
        }
        # cumulative cost has one entry per hour
        assert len(s["cumulative_cost"]) == 48


def test_run_backtest_baseline_has_zero_savings(monkeypatch):
    monkeypatch.setattr(backtest, "load_history", lambda days: _synthetic_df())
    result = backtest.run_backtest(2)
    baseline = next(s for s in result["strategies"] if "baseline" in s["name"])
    assert baseline["savings_pct"] == 0.0


def test_run_backtest_best_is_cheapest(monkeypatch):
    monkeypatch.setattr(backtest, "load_history", lambda days: _synthetic_df())
    result = backtest.run_backtest(2)
    cheapest = min(result["strategies"], key=lambda s: s["cost_pln"])
    assert result["best"] == cheapest["name"]


def test_run_backtest_clamps_days(monkeypatch):
    monkeypatch.setattr(backtest, "load_history", lambda days: _synthetic_df())
    # 200 → clamped to 90
    assert backtest.run_backtest(200)["days"] == 90
    # 0 → clamped to 1
    assert backtest.run_backtest(0)["days"] == 1


@pytest.mark.parametrize("days", [1, 3, 7, 14, 30])
def test_run_backtest_various_periods(monkeypatch, days):
    monkeypatch.setattr(backtest, "load_history", lambda d: _synthetic_df())
    result = backtest.run_backtest(days)
    assert result["days"] == days
    assert "strategies" in result
