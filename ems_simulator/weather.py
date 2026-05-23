import datetime
import requests
from ems_simulator.config import WEATHER_URL, WEATHER_ML_URL, LAT, LON

_cache = {}
_last_refresh = -1

def fetch():
    global _cache
    try:
        r = requests.get(WEATHER_URL, timeout=10)
        data = r.json()
        c = {}
        times = data["hourly"]["time"]
        rad = data["hourly"]["shortwave_radiation"]
        temp = data["hourly"]["temperature_2m"]
        cloud = data["hourly"]["cloud_cover"]
        for i, t in enumerate(times):
            dt = datetime.datetime.fromisoformat(t)
            c[dt.hour] = {"ghi": rad[i], "temp": temp[i], "cloud": cloud[i]}
        _cache = c
        print(f"[WEATHER] Fetched {len(c)} hours")
        for h in sorted(c):
            print(f"  h{h:02d}: GHI={c[h]['ghi']:3.0f}W/m2  {c[h]['temp']:4.1f}C  clouds={c[h]['cloud']:2.0f}%")
    except Exception as e:
        print(f"[WEATHER] Fetch failed: {e}")

def get(hour):
    h = int(hour) % 24
    if h in _cache:
        return _cache[h]["ghi"], _cache[h]["temp"], _cache[h]["cloud"]
    return None, None, None

def needs_refresh(hour, day_step):
    global _last_refresh
    h = int(hour) % 24
    if h != _last_refresh and day_step % 12 == 0:
        _last_refresh = h
        return True
    return False


def archive_df(start_date: str, end_date: str):
    """Return list of {ds, ghi, temp, cloud} for a past date range (Open-Meteo Archive API)."""
    url = (
        f"https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={LAT}&longitude={LON}"
        f"&start_date={start_date}&end_date={end_date}"
        f"&hourly=shortwave_radiation,temperature_2m,cloud_cover"
        f"&timezone=Europe/Warsaw"
    )
    try:
        r = requests.get(url, timeout=10)
        data = r.json()
        rows = []
        for i, t in enumerate(data["hourly"]["time"]):
            rows.append({
                "ds": datetime.datetime.fromisoformat(t),
                "ghi": data["hourly"]["shortwave_radiation"][i],
                "temp": data["hourly"]["temperature_2m"][i],
                "cloud": data["hourly"]["cloud_cover"][i],
            })
        print(f"[WEATHER] Archive: {len(rows)} hours ({start_date} to {end_date})")
        return rows
    except Exception as e:
        print(f"[WEATHER] Archive fetch failed: {e}")
        return []


def ml_forecast_df(past_days: int = 3):
    """Return list of {ds, ghi, temp, cloud} with past_days history + 2-day forecast."""
    url = WEATHER_ML_URL.format(days=past_days)
    try:
        r = requests.get(url, timeout=10)
        data = r.json()
        rows = []
        for i, t in enumerate(data["hourly"]["time"]):
            rows.append({
                "ds": datetime.datetime.fromisoformat(t),
                "ghi": data["hourly"]["shortwave_radiation"][i],
                "temp": data["hourly"]["temperature_2m"][i],
                "cloud": data["hourly"]["cloud_cover"][i],
            })
        print(f"[WEATHER] ML data: {len(rows)} hours (past {past_days}d + 2d forecast)")
        return rows
    except Exception as e:
        print(f"[WEATHER] ML data fetch failed: {e}")
        return []


def forecast_df():
    """Return a DataFrame with datetime, ghi, temp, cloud for all forecast hours."""
    try:
        r = requests.get(WEATHER_URL, timeout=10)
        data = r.json()
        rows = []
        for i, t in enumerate(data["hourly"]["time"]):
            rows.append({
                "ds": datetime.datetime.fromisoformat(t),
                "ghi": data["hourly"]["shortwave_radiation"][i],
                "temp": data["hourly"]["temperature_2m"][i],
                "cloud": data["hourly"]["cloud_cover"][i],
            })
        print(f"[WEATHER] Forecast: {len(rows)} hours ({rows[0]['ds']} to {rows[-1]['ds']})")
        return rows
    except Exception as e:
        print(f"[WEATHER] Forecast fetch failed: {e}")
        return []
