"""Strategy backtesting (4.3).

Reads historical PV, load, and price data from InfluxDB, then re-simulates
four battery strategies and compares their economics:

  baseline   — no battery at all
  auto       — battery auto-mode (charge on PV surplus, discharge on deficit)
  scheduled  — auto + cheap overnight grid charging (charge-scheduler logic)
  mpc        — auto + MPC optimizer (charge cheap, discharge expensive)

Usage:
    python backtest.py [days]          # default: 7 days
    python backtest.py 14 --no-plot
"""

import argparse
import sys
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from influxdb_client import InfluxDBClient

from ems_simulator.config import BATTERY_KWH

# ── config ─────────────────────────────────────────────────────────────────────
# Imported, not re-declared: the battery size and efficiency used here must be the
# ones the simulator runs with, or the "savings" this reports describe a different
# system than the dashboard does.
from ems_simulator.config import INFLUX_BUCKET as BUCKET
from ems_simulator.config import INFLUX_ORG as ORG
from ems_simulator.config import INFLUX_TOKEN as TOKEN
from ems_simulator.config import INFLUX_URL as URL
from ems_simulator.config import INVERTER_EFFICIENCY as EFFICIENCY

# Backtest-only strategy parameters (not part of the live simulation).
CHARGE_KW = 5.0
DISCHARGE_KW = 5.0
SOC_INIT = 50.0
SOC_MAX = 90.0
SOC_MIN = 20.0

# gr → PLN: the energy multiplied by the price below is in kWh, so
# kWh * gr/kWh / 100 = PLN. Was 100 * 1000 (the denominator for Wh), which made
# every cost_pln, savings_pln and savings_year_est here 1000x too small. Ratios
# (savings_pct) and the ranking of strategies were unaffected, which is why the
# existing tests — they only check shape and ordering — never caught it.
PRICE_SCALE = 100.0

# Distribution tariff bands (hour_start, hour_end, gr/kWh)
DISTRIBUTION_ZONES = [
    (0, 6, 12), (6, 13, 28), (13, 15, 12), (15, 22, 28), (22, 24, 12),
]


# ── data loading ───────────────────────────────────────────────────────────────

def _query(client, sensor, days, field):
    q = (
        f'from(bucket: "{BUCKET}")'
        f' |> range(start: -{days}d)'
        f' |> filter(fn: (r) => r._measurement == "{sensor}")'
        f' |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)'
        f' |> yield(name: "mean")'
    )
    rows = []
    for table in client.query_api().query(q):
        for r in table.records:
            val = r.get_value()
            if val is not None:
                rows.append({"ds": r.get_time(), field: float(val)})
    return pd.DataFrame(rows)


def load_history(days):
    """Return hourly DataFrame with columns [ds, pv_w, load_w, price_gr, hour]."""
    client = InfluxDBClient(url=URL, token=TOKEN, org=ORG)
    try:
        pv = _query(client, "sensor.sztuczna_produkcja_pv", days, "pv_w")
        load = _query(client, "sensor.ems_pobor_domu_bazowy", days, "load_w")
        price = _query(client, "sensor.ems_biezaca_cena_energii", days, "price_gr")
    finally:
        client.close()

    if pv.empty or load.empty or price.empty:
        return pd.DataFrame()

    for df in (pv, load, price):
        df["ds"] = pd.to_datetime(df["ds"]).dt.tz_localize(None).dt.floor("1h")

    df = pv.merge(load, on="ds", how="inner").merge(price, on="ds", how="inner")
    df = df.sort_values("ds").reset_index(drop=True)
    df["hour"] = df["ds"].dt.hour
    return df


# ── simulation engine ──────────────────────────────────────────────────────────

def _distribution_rate(hour):
    for start, end, rate in DISTRIBUTION_ZONES:
        if start <= hour < end:
            return rate
    return 12


@dataclass
class SimResult:
    name: str
    cost_pln: float = 0.0
    import_kwh: float = 0.0
    export_kwh: float = 0.0
    charge_cycles: float = 0.0       # equivalent full cycles (2×capacity per cycle)
    self_sufficiency: float = 0.0    # fraction of load met without grid import
    hourly_cost: list[float] = field(default_factory=list)


def _simulate_hours(df, actions):
    """Simulate one strategy given a per-row action list (MODE_AUTO/CHARGE/DISCHARGE).

    Returns SimResult.
    """
    _MODE_AUTO, MODE_CHARGE, MODE_DISCHARGE = 0, 1, 2

    soc = SOC_INIT
    total_cost = 0.0
    total_import = 0.0
    total_export = 0.0
    kwh_throughput = 0.0
    load_hours_covered = 0
    hourly = []

    for i, row in df.iterrows():
        pv_w = row["pv_w"]
        load_w = row["load_w"]
        price_gr = row["price_gr"]
        hour = int(row["hour"])
        action = actions[i]
        balance_kwh = (pv_w - load_w) / 1000.0  # positive = surplus

        if action == MODE_CHARGE:
            bat_in_kwh = CHARGE_KW * EFFICIENCY
            delta_soc = bat_in_kwh / BATTERY_KWH * 100.0
            soc = min(SOC_MAX, soc + delta_soc)
            kwh_throughput += bat_in_kwh
            grid_import_kwh = max(0.0, load_w / 1000.0 + CHARGE_KW - pv_w / 1000.0)
            grid_export_kwh = max(0.0, pv_w / 1000.0 - load_w / 1000.0 - CHARGE_KW)

        elif action == MODE_DISCHARGE:
            bat_out_kwh = DISCHARGE_KW / EFFICIENCY
            delta_soc = -bat_out_kwh / BATTERY_KWH * 100.0
            soc = max(SOC_MIN, soc + delta_soc)
            kwh_throughput += bat_out_kwh
            net_import_w = load_w - pv_w - DISCHARGE_KW * 1000.0
            grid_import_kwh = max(0.0, net_import_w / 1000.0)
            grid_export_kwh = max(0.0, -net_import_w / 1000.0)

        else:  # auto
            if balance_kwh >= 0:
                headroom = (SOC_MAX - soc) / 100.0 * BATTERY_KWH
                bat_in = min(balance_kwh * EFFICIENCY, headroom)
                soc += bat_in / BATTERY_KWH * 100.0
                kwh_throughput += bat_in
                grid_import_kwh = 0.0
                grid_export_kwh = balance_kwh - bat_in / EFFICIENCY
            else:
                avail = max(0.0, (soc - SOC_MIN) / 100.0 * BATTERY_KWH)
                bat_out = min(-balance_kwh / EFFICIENCY, avail)
                soc -= bat_out * EFFICIENCY / BATTERY_KWH * 100.0
                kwh_throughput += bat_out
                grid_import_kwh = max(0.0, -balance_kwh - bat_out)
                grid_export_kwh = 0.0

        soc = max(0.0, min(100.0, soc))

        dist = _distribution_rate(hour) if grid_import_kwh > 0 else 0.0
        cost = grid_import_kwh * (price_gr + dist) / PRICE_SCALE
        total_cost += cost
        total_import += grid_import_kwh
        total_export += grid_export_kwh
        if grid_import_kwh < load_w / 1000.0:
            load_hours_covered += 1
        hourly.append(cost)

    n = len(df)
    return SimResult(
        name="",
        cost_pln=total_cost,
        import_kwh=total_import,
        export_kwh=total_export,
        charge_cycles=kwh_throughput / (2.0 * BATTERY_KWH),
        self_sufficiency=load_hours_covered / n if n else 0.0,
        hourly_cost=hourly,
    )


# ── strategy implementations ────────────────────────────────────────────────────

def strategy_baseline(df):
    """No battery — always import deficit, export surplus."""
    result = SimResult(name="baseline (no battery)")
    for _, row in df.iterrows():
        pv_w, load_w, price_gr = row["pv_w"], row["load_w"], row["price_gr"]
        hour = int(row["hour"])
        import_kwh = max(0.0, (load_w - pv_w) / 1000.0)
        export_kwh = max(0.0, (pv_w - load_w) / 1000.0)
        dist = _distribution_rate(hour) if import_kwh > 0 else 0.0
        result.cost_pln += import_kwh * (price_gr + dist) / PRICE_SCALE
        result.import_kwh += import_kwh
        result.export_kwh += export_kwh
        result.hourly_cost.append(import_kwh * (price_gr + dist) / PRICE_SCALE)
    n = len(df)
    result.self_sufficiency = sum(
        1 for _, r in df.iterrows() if r["pv_w"] >= r["load_w"]
    ) / n if n else 0.0
    return result


def strategy_auto(df):
    """Battery in auto mode (no active scheduling)."""
    n = len(df)
    actions = [0] * n
    r = _simulate_hours(df, actions)
    r.name = "auto (no scheduling)"
    return r


def strategy_scheduled(df):
    """Cheap overnight charging (charge-scheduler heuristic)."""
    price_arr = df["price_gr"].to_numpy()
    n = len(df)
    actions = [0] * n

    # For each day, pick the 2 cheapest hours between 22-08 to force-charge
    days = df["ds"].dt.date.unique()
    for day in days:
        mask = df["ds"].dt.date == day
        night_idx = df.index[mask & df["hour"].isin(list(range(22, 24)) + list(range(0, 8)))]
        if len(night_idx) < 2:
            continue
        cheapest = sorted(night_idx, key=lambda i: price_arr[i])[:2]
        for i in cheapest:
            actions[i] = 1  # CHARGE

    r = _simulate_hours(df, actions)
    r.name = "scheduled (overnight cheap charge)"
    return r


def strategy_mpc(df):
    """Per-hour greedy MPC: charge cheap (p25), discharge expensive (p75)."""
    price_arr = df["price_gr"].to_numpy()
    n = len(df)
    actions = [0] * n

    p25 = float(np.percentile(price_arr, 25))
    p75 = float(np.percentile(price_arr, 75))

    soc = SOC_INIT
    for i, row in df.iterrows():
        pv_w, load_w, price_gr = row["pv_w"], row["load_w"], row["price_gr"]
        balance_kwh = (pv_w - load_w) / 1000.0

        if price_gr <= p25 and soc < SOC_MAX - 5:
            actions[i] = 1  # cheap → grid charge
        elif price_gr >= p75 and soc > SOC_MIN + 10 and balance_kwh < 0:
            actions[i] = 2  # expensive deficit → discharge
        # else: auto

        # Approximate SoC update for action selection in next step
        if actions[i] == 1:
            soc = min(SOC_MAX, soc + CHARGE_KW * EFFICIENCY / BATTERY_KWH * 100)
        elif actions[i] == 2:
            soc = max(SOC_MIN, soc - DISCHARGE_KW / EFFICIENCY / BATTERY_KWH * 100)
        elif balance_kwh >= 0:
            soc = min(SOC_MAX, soc + balance_kwh * EFFICIENCY / BATTERY_KWH * 100)
        else:
            avail = max(0.0, (soc - SOC_MIN) / 100.0 * BATTERY_KWH)
            bat_out = min(-balance_kwh / EFFICIENCY, avail)
            soc = max(SOC_MIN, soc - bat_out * EFFICIENCY / BATTERY_KWH * 100)
        soc = max(0.0, min(100.0, soc))

    r = _simulate_hours(df, actions)
    r.name = "mpc (price-adaptive)"
    return r


# ── reporting ──────────────────────────────────────────────────────────────────

def _bar(val, max_val, width=20, fill="#", empty="-"):
    filled = int(round(val / max_val * width)) if max_val > 0 else 0
    return fill * filled + empty * (width - filled)


def print_report(results, days):
    baseline = next((r for r in results if "baseline" in r.name), results[0])
    print(f"\n{'─'*72}")
    print(f"  Backtest report — {days} days of history")
    print(f"{'─'*72}")
    header = f"  {'Strategy':<34} {'Cost (PLN)':>10} {'Import kWh':>10} {'Self-suff':>9} {'Cycles':>7}"
    print(header)
    print(f"  {'-'*34} {'-'*10} {'-'*10} {'-'*9} {'-'*7}")
    max_cost = max(r.cost_pln for r in results)
    for r in results:
        savings_pct = (1 - r.cost_pln / baseline.cost_pln) * 100 if baseline.cost_pln > 0 else 0
        bar = _bar(r.cost_pln, max_cost)
        mark = f"  ({savings_pct:+.1f}%)" if r is not baseline else "  (baseline)"
        print(f"  {r.name:<34} {r.cost_pln:>10.2f} {r.import_kwh:>10.1f} "
              f"{r.self_sufficiency:>8.1%} {r.charge_cycles:>7.1f}"
              f"  {bar}{mark}")
    best = min(results, key=lambda r: r.cost_pln)
    saved = baseline.cost_pln - best.cost_pln
    print(f"\n  Best strategy : {best.name}")
    print(f"  Savings vs baseline: {saved:.2f} PLN over {days} days "
          f"({saved / days * 365:.0f} PLN/year est.)")
    print(f"{'─'*72}\n")


def plot_results(df, results, days):
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed — skipping plot")
        return

    fig, axes = plt.subplots(3, 1, figsize=(14, 10), sharex=True)
    ts = df["ds"].values

    axes[0].set_title(f"Backtest: {days} days — PV & Load", fontsize=12)
    axes[0].fill_between(ts, df["pv_w"].values / 1000, alpha=0.4, label="PV (kW)", color="gold")
    axes[0].fill_between(ts, df["load_w"].values / 1000, alpha=0.3, label="Load (kW)", color="steelblue")
    axes[0].set_ylabel("kW")
    axes[0].legend(loc="upper right", fontsize=9)

    axes[1].set_title("Price (gr/kWh)")
    axes[1].plot(ts, df["price_gr"].values, color="crimson", linewidth=1)
    axes[1].set_ylabel("gr/kWh")

    axes[2].set_title("Cumulative cost (PLN)")
    colors = ["gray", "steelblue", "green", "darkorange"]
    for r, color in zip(results, colors, strict=False):
        cum = pd.Series(r.hourly_cost).cumsum().values
        axes[2].plot(ts, cum, label=r.name, linewidth=1.5, color=color)
    axes[2].set_ylabel("PLN")
    axes[2].legend(loc="upper left", fontsize=9)

    fig.tight_layout()
    fname = f"backtest_{days}d.png"
    fig.savefig(fname, dpi=150)
    print(f"  Plot saved: {fname}")


# ── programmatic API (used by the health server /backtest endpoint) ─────────────

def run_backtest(days: int = 7) -> dict:
    """Run all strategies and return a JSON-serializable result dict.

    Shape:
      {
        "days": int, "rows": int, "from": iso, "to": iso,
        "strategies": [
          {"name", "cost_pln", "savings_pct", "import_kwh", "export_kwh",
           "self_sufficiency", "charge_cycles", "cumulative_cost": [...]}
        ],
        "best": name, "savings_pln": float, "savings_year_est": float,
        "timeline": [iso, ...]            # hourly timestamps for the charts
      }
    On no data: {"error": "no_data", "days": int}.
    """
    days = max(1, min(int(days), 90))
    df = load_history(days)
    if df.empty:
        return {"error": "no_data", "days": days}

    results = [
        strategy_baseline(df),
        strategy_auto(df),
        strategy_scheduled(df),
        strategy_mpc(df),
    ]
    baseline = next((r for r in results if "baseline" in r.name), results[0])
    best = min(results, key=lambda r: r.cost_pln)
    saved = baseline.cost_pln - best.cost_pln

    def _cum(hourly):
        out, acc = [], 0.0
        for c in hourly:
            acc += c
            out.append(round(acc, 4))
        return out

    strategies = []
    for r in results:
        savings_pct = (1 - r.cost_pln / baseline.cost_pln) * 100 if baseline.cost_pln > 0 else 0.0
        strategies.append({
            "name": r.name,
            "cost_pln": round(r.cost_pln, 2),
            "savings_pct": round(savings_pct, 1),
            "import_kwh": round(r.import_kwh, 1),
            "export_kwh": round(r.export_kwh, 1),
            "self_sufficiency": round(r.self_sufficiency, 3),
            "charge_cycles": round(r.charge_cycles, 1),
            "cumulative_cost": _cum(r.hourly_cost),
        })

    return {
        "days": days,
        "rows": len(df),
        "from": df["ds"].min().isoformat(),
        "to": df["ds"].max().isoformat(),
        "strategies": strategies,
        "best": best.name,
        "savings_pln": round(saved, 2),
        "savings_year_est": round(saved / days * 365, 0),
        "timeline": [t.isoformat() for t in df["ds"]],
    }


# ── entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="EMS strategy backtester")
    parser.add_argument("days", nargs="?", type=int, default=7,
                        help="How many past days to backtest (default: 7)")
    parser.add_argument("--no-plot", action="store_true", help="Skip matplotlib output")
    args = parser.parse_args()

    print(f"Loading {args.days} days of history from InfluxDB...")
    df = load_history(args.days)
    if df.empty:
        print("No data found. Start the simulator first: python run.py")
        sys.exit(1)

    print(f"Loaded {len(df)} hourly rows ({df['ds'].min()} → {df['ds'].max()})\n")
    print("Running strategies...")

    results = [
        strategy_baseline(df),
        strategy_auto(df),
        strategy_scheduled(df),
        strategy_mpc(df),
    ]

    print_report(results, args.days)

    if not args.no_plot:
        plot_results(df, results, args.days)


if __name__ == "__main__":
    main()
