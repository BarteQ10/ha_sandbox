"""PV forecast using GHI/temp/cloud from Open-Meteo (past + future) + PV from InfluxDB.

GHI=0 at night automatically -> forecast PV=0 at night.
"""

import os
from datetime import datetime, timedelta

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from influxdb_client import InfluxDBClient
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error

from ems_simulator.weather import ml_forecast_df

BUCKET = "ems"
ORG = "home"
TOKEN = "ems-token"
URL = "http://localhost:8086"

FEATURES = ["ghi", "temp", "cloud", "hour_sin", "hour_cos"]


def query_pv_influx(days: int) -> pd.DataFrame:
    """Load PV and temperature from InfluxDB."""
    client = InfluxDBClient(url=URL, token=TOKEN, org=ORG)
    out = {}
    for sensor, name in [("sensor.sztuczna_produkcja_pv", "pv"),
                         ("sensor.current_temp", "temp_influx")]:
        q = f"""
        from(bucket: "{BUCKET}")
          |> range(start: -{days}d)
          |> filter(fn: (r) => r["_measurement"] == "{sensor}")
          |> aggregateWindow(every: 5m, fn: mean)
          |> yield(name: "mean")
        """
        tables = client.query_api().query(q)
        rows = []
        for table in tables:
            for r in table.records:
                val = r.get_value()
                if val is not None:
                    rows.append({"ds": r.get_time(), name: val})
        out[name] = pd.DataFrame(rows)
    client.close()

    merged = None
    for name, df in out.items():
        if df.empty:
            continue
        if merged is None:
            merged = df
        else:
            merged = merged.merge(df, on="ds", how="outer")
    if merged is None or merged.empty:
        return pd.DataFrame()
    return merged.sort_values("ds").reset_index(drop=True)


def add_hour_features(df: pd.DataFrame) -> pd.DataFrame:
    df["hour"] = df["ds"].dt.hour
    df["hour_sin"] = np.sin(2 * np.pi * df["hour"] / 24)
    df["hour_cos"] = np.cos(2 * np.pi * df["hour"] / 24)
    return df


def load_training_data(days: int):
    print(f"Fetching weather data (past {days}d + 2d forecast) from Open-Meteo...")
    weather = ml_forecast_df(past_days=days)
    if not weather:
        print("No weather data.")
        return None, None, None
    wdf = pd.DataFrame(weather)
    wdf["ds"] = pd.to_datetime(wdf["ds"])
    wdf["ds_h"] = wdf["ds"].dt.floor("h")
    add_hour_features(wdf)

    print("Loading PV from InfluxDB...")
    pvdf = query_pv_influx(days)
    if pvdf.empty:
        print("No PV data. Run simulator first: python run.py")
        return None, None, None

    pvdf["ds"] = pd.to_datetime(pvdf["ds"])
    pvdf["ds"] = pvdf["ds"].dt.tz_localize(None)
    pvdf["ds_h"] = pvdf["ds"].dt.round("h")
    pv_hourly = pvdf.groupby("ds_h").agg(pv=("pv", "mean")).reset_index()

    merged = wdf.merge(pv_hourly, on="ds_h", how="left")
    merged = merged.drop(columns=["ds_h"])

    past = merged.dropna(subset=["pv"]).copy().reset_index(drop=True)
    future = merged[merged["pv"].isna()].copy().reset_index(drop=True)

    return past, future, [c for c in FEATURES if c in merged.columns]


def main(days: int = 3, forecast_hours: int = 48):
    past, future, avail = load_training_data(days)
    if past is None or future is None:
        return

    print(f"Past: {len(past)} hourly rows, Future: {len(future)} hourly rows")
    print(f"Features: {avail}")

    train = past.dropna(subset=avail + ["pv"]).copy()
    print(f"Training rows (non-null PV): {len(train)}")

    if len(train) < 6:
        print("Too few training points. Let the simulator run longer.")
        return

    X = train[avail].values.astype(np.float64)
    y = train["pv"].values.astype(np.float64)

    model = RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42, n_jobs=-1)
    model.fit(X, y)

    y_pred = model.predict(X)
    mae = mean_absolute_error(y, y_pred)
    print(f"Train MAE: {mae:.0f} W")

    X_future = future[avail].values.astype(np.float64)
    future["pv_pred"] = model.predict(X_future)

    night = future["ghi"] < 1
    future.loc[night, "pv_pred"] = 0.0

    print(f"\nForecast ({forecast_hours}h, first 12 rows):")
    cols = ["ds"] + avail + ["pv_pred"]
    print(future[cols].head(12).to_string(index=False))

    fig, ax = plt.subplots(figsize=(14, 6))

    ax.plot(pd.to_datetime(train["ds"]), train["pv"].values,
            "k.", alpha=0.4, markersize=2, label="observed PV")

    ax.plot(future["ds"].values[:forecast_hours], future["pv_pred"].values[:forecast_hours],
            "b-", linewidth=2, label=f"forecast ({forecast_hours}h)")

    ax.set_title(f"PV Forecast — Features: {' + '.join(avail)}", fontsize=14)
    ax.set_ylabel("Power (W)")
    ax.set_xlabel("Time")
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig("forecast.png", dpi=150)
    print("\nSaved forecast.png")

    if hasattr(model, "feature_importances_"):
        fi = pd.DataFrame({"feature": avail, "importance": model.feature_importances_})\
               .sort_values("importance", ascending=True)
        print(f"\nFeature importances:\n{fi.to_string(index=False)}")
        fig2, ax2 = plt.subplots(figsize=(6, 4))
        ax2.barh(fi["feature"], fi["importance"])
        ax2.set_title("Feature Importance")
        ax2.set_xlabel("Importance")
        fig2.tight_layout()
        fig2.savefig("forecast_feature_importance.png", dpi=150)
        print("Saved forecast_feature_importance.png")


if __name__ == "__main__":
    import sys
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    main(days=days, forecast_hours=48)
