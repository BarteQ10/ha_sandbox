"""Price & load forecasting (4.1): RF models for PV output, house load, and grid price.

ForecastEngine trains three RandomForest models from InfluxDB history + Open-Meteo
weather, refreshing once per simulated day.  predict_next_24h() returns a dict with
"pv", "load", and "price" lists (24 hourly floats each).  When InfluxDB history is
sparse, deterministic fallbacks are returned transparently.
"""

import datetime
import logging
import os

import numpy as np
import pandas as pd
from influxdb_client import InfluxDBClient
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error

from ems_simulator.config import PV_PEAK_KW

log = logging.getLogger(__name__)

_URL = os.environ.get("INFLUX_URL", "http://localhost:8086")
_TOKEN = os.environ.get("INFLUX_TOKEN", "ems-token")
_ORG = os.environ.get("INFLUX_ORG", "home")
_BUCKET = os.environ.get("INFLUX_BUCKET", "ems")

MIN_TRAIN_ROWS = 24   # minimum hourly points required before fitting
HISTORY_DAYS = 7      # how many past days of InfluxDB data to train on


# ── helpers ───────────────────────────────────────────────────────────────────

def _query_hourly(sensor, days, field):
    """Return DataFrame[ds, <field>] at 1-hour resolution from InfluxDB."""
    client = InfluxDBClient(url=_URL, token=_TOKEN, org=_ORG)
    try:
        q = (
            f'from(bucket: "{_BUCKET}")'
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
    except Exception as exc:
        log.warning("[FORECAST] InfluxDB query failed (%s): %s", sensor, exc)
        return pd.DataFrame()
    finally:
        client.close()


def _add_time_features(df):
    """Append cyclical hour/dow/month columns to df (returns a copy)."""
    df = df.copy()
    hour = df["ds"].dt.hour + df["ds"].dt.minute / 60.0
    dow = df["ds"].dt.dayofweek
    month = df["ds"].dt.month
    df["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    df["dow_sin"] = np.sin(2 * np.pi * dow / 7)
    df["dow_cos"] = np.cos(2 * np.pi * dow / 7)
    df["month_sin"] = np.sin(2 * np.pi * (month - 1) / 12)
    df["month_cos"] = np.cos(2 * np.pi * (month - 1) / 12)
    return df


def _weather_future_df():
    """24-row DataFrame with [ds, ghi, temp, cloud] starting from the current hour.

    Pulls from the in-memory weather cache populated by the main loop's hourly
    fetch — no extra HTTP call needed.
    """
    from ems_simulator.weather import forecast_df  # imported here to avoid circular deps
    now = datetime.datetime.now().replace(minute=0, second=0, microsecond=0)

    rows = forecast_df()
    if rows:
        wdf = pd.DataFrame(rows)
        wdf["ds"] = pd.to_datetime(wdf["ds"])
        future = wdf[wdf["ds"] >= pd.Timestamp(now)].head(24).copy()
        if len(future) == 24:
            return future[["ds", "ghi", "temp", "cloud"]].reset_index(drop=True)

    # Fallback when weather cache is not yet populated (very first tick)
    hours = [now + datetime.timedelta(hours=i) for i in range(24)]
    return pd.DataFrame({"ds": pd.to_datetime(hours), "ghi": 0.0, "temp": 15.0, "cloud": 50.0})


# ── model wrapper ─────────────────────────────────────────────────────────────

class _RFModel:
    """Thin RandomForest wrapper with fit/predict and a ready flag."""

    def __init__(self, name, features):
        self.name = name
        self.features = features
        self._rf = None

    @property
    def ready(self):
        return self._rf is not None

    def fit(self, df, target):
        train = df.dropna(subset=self.features + [target])
        if len(train) < MIN_TRAIN_ROWS:
            log.warning("[FORECAST] %s: %d rows < %d required — skipping fit",
                        self.name, len(train), MIN_TRAIN_ROWS)
            return False
        X = train[self.features].to_numpy(dtype=np.float64)
        y = train[target].to_numpy(dtype=np.float64)
        rf = RandomForestRegressor(n_estimators=100, max_depth=10, random_state=42, n_jobs=-1)
        rf.fit(X, y)
        mae = mean_absolute_error(y, rf.predict(X))
        log.info("[FORECAST] %s: fit on %d rows, train MAE=%.2f", self.name, len(train), mae)
        self._rf = rf
        return True

    def predict(self, df):
        """Return np.ndarray or None if not ready / missing features."""
        if not self.ready:
            return None
        missing = [f for f in self.features if f not in df.columns]
        if missing:
            log.warning("[FORECAST] %s: missing features %s", self.name, missing)
            return None
        return self._rf.predict(df[self.features].to_numpy(dtype=np.float64))


# ── public class ──────────────────────────────────────────────────────────────

class ForecastEngine:
    """
    Trains and serves 24-hour-ahead forecasts for PV output, house load, and energy price.

    Typical usage in the main loop:
        engine = ForecastEngine()
        engine.fit_all()                  # once at startup + once per simulated day
        fc = engine.predict_next_24h()    # {"pv": [...], "load": [...], "price": [...]}

    fit_all() is best-effort: if InfluxDB is unavailable or has too little history
    the models stay un-fitted and predict_next_24h() returns deterministic fallbacks.
    """

    def __init__(self, history_days=HISTORY_DAYS):
        self.history_days = history_days
        self._pv = _RFModel(
            "PvForecaster",
            ["ghi", "temp", "cloud", "hour_sin", "hour_cos"],
        )
        self._load = _RFModel(
            "LoadForecaster",
            ["hour_sin", "hour_cos", "dow_sin", "dow_cos", "temp", "cloud"],
        )
        self._price = _RFModel(
            "PriceForecaster",
            ["hour_sin", "hour_cos", "dow_sin", "dow_cos", "month_sin", "month_cos"],
        )
        self._last_fit_date = None

    def needs_refit(self):
        return self._last_fit_date != datetime.date.today()

    # ── private fit methods ────────────────────────────────────────────────────

    def _fit_pv(self):
        from ems_simulator.weather import ml_forecast_df
        rows = ml_forecast_df(past_days=self.history_days)
        if not rows:
            log.warning("[FORECAST] PV: no weather data from Open-Meteo")
            return
        wdf = pd.DataFrame(rows)
        wdf["ds"] = pd.to_datetime(wdf["ds"])
        wdf = wdf.set_index("ds").resample("1h").ffill().reset_index()
        wdf = _add_time_features(wdf)

        pvdf = _query_hourly("sensor.sztuczna_produkcja_pv", self.history_days, "pv")
        if pvdf.empty:
            log.warning("[FORECAST] PV: no PV history in InfluxDB")
            return
        pvdf["ds"] = pd.to_datetime(pvdf["ds"]).dt.tz_localize(None).dt.floor("1h")
        df = wdf.merge(pvdf, on="ds", how="left")
        self._pv.fit(df.dropna(subset=["pv"]), "pv")

    def _fit_load(self):
        ldf = _query_hourly("sensor.ems_pobor_domu_bazowy", self.history_days, "load")
        if ldf.empty:
            log.warning("[FORECAST] Load: no load history in InfluxDB")
            return
        ldf["ds"] = pd.to_datetime(ldf["ds"]).dt.tz_localize(None).dt.floor("1h")

        from ems_simulator.weather import ml_forecast_df
        rows = ml_forecast_df(past_days=self.history_days)
        if rows:
            wdf = pd.DataFrame(rows)
            wdf["ds"] = pd.to_datetime(wdf["ds"])
            wdf = wdf.set_index("ds").resample("1h").ffill().reset_index()
            ldf = ldf.merge(wdf[["ds", "temp", "cloud"]], on="ds", how="left")
        else:
            ldf["temp"] = 15.0
            ldf["cloud"] = 50.0

        ldf = _add_time_features(ldf)
        self._load.fit(ldf, "load")

    def _fit_price(self):
        pdf = _query_hourly("sensor.ems_biezaca_cena_energii", self.history_days, "price")
        if pdf.empty:
            log.warning("[FORECAST] Price: no price history in InfluxDB")
            return
        pdf["ds"] = pd.to_datetime(pdf["ds"]).dt.tz_localize(None).dt.floor("1h")
        pdf = _add_time_features(pdf)
        self._price.fit(pdf, "price")

    # ── public API ─────────────────────────────────────────────────────────────

    def fit_all(self):
        """(Re)train all three models.  Safe to call even when data is unavailable."""
        log.info("[FORECAST] fit_all() — history=%dd", self.history_days)
        self._fit_pv()
        self._fit_load()
        self._fit_price()
        self._last_fit_date = datetime.date.today()
        log.info("[FORECAST] fit_all() done — pv=%s  load=%s  price=%s",
                 self._pv.ready, self._load.ready, self._price.ready)

    def predict_next_24h(self):
        """Return {"pv": [...], "load": [...], "price": [...]} — 24 hourly floats each.

        Falls back to deterministic estimates when the corresponding model is not ready.
        """
        from ems_simulator.generators import base_load
        from ems_simulator.pricing import fallback_price

        future = _weather_future_df()
        feat = _add_time_features(future)
        hours = feat["ds"].dt.hour.tolist()

        # PV ──
        pv_arr = self._pv.predict(feat)
        if pv_arr is not None:
            ghi = feat["ghi"].to_numpy()
            pv_arr = np.clip(pv_arr, 0, None)
            pv_arr[ghi < 1] = 0.0
        else:
            ghi = feat["ghi"].to_numpy()
            pv_arr = np.clip(ghi * PV_PEAK_KW * 0.9, 0, 5000.0)

        # Load ──
        load_arr = self._load.predict(feat)
        if load_arr is not None:
            load_arr = np.clip(load_arr, 0, None)
        else:
            temp = float(feat["temp"].mean())
            load_arr = np.array([base_load(h, temp) for h in hours], dtype=np.float64)

        # Price ──
        price_arr = self._price.predict(feat)
        if price_arr is not None:
            price_arr = np.clip(price_arr, 0, None)
        else:
            price_arr = np.array([float(fallback_price(h)) for h in hours], dtype=np.float64)

        return {
            "pv": pv_arr.tolist(),
            "load": load_arr.tolist(),
            "price": price_arr.tolist(),
        }

    def summary(self, forecast):
        """Return compact summary dict for logging / InfluxDB writes."""
        pv = forecast.get("pv", [])
        load = forecast.get("load", [])
        price = forecast.get("price", [])
        return {
            "pv_day_kwh": round(sum(pv) / 1000.0, 1),
            "load_day_kwh": round(sum(load) / 1000.0, 1),
            "price_avg": round(float(np.mean(price)), 1) if price else 0.0,
            "price_peak": round(float(np.max(price)), 1) if price else 0.0,
        }
