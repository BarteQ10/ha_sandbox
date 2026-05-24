import datetime
import requests
from ems_simulator.config import WEATHER_URL, WEATHER_ML_URL, LAT, LON

_cache = {}
_forecast_rows = []
_last_refresh = -1

def _parse_rows(data):
    rows = []
    for i, t in enumerate(data["hourly"]["time"]):
        rows.append({
            "ds": datetime.datetime.fromisoformat(t),
            "ghi": data["hourly"]["shortwave_radiation"][i],
            "temp": data["hourly"]["temperature_2m"][i],
            "cloud": data["hourly"]["cloud_cover"][i],
        })
    return rows

def fetch():
    global _cache, _forecast_rows
    try:
        r = requests.get(WEATHER_URL, timeout=10)
        data = r.json()
        rows = _parse_rows(data)
        _forecast_rows = rows
        c = {}
        for row in rows:
            d = row["ds"].date()
            h = row["ds"].hour
            c[(d, h)] = {"ghi": row["ghi"], "temp": row["temp"], "cloud": row["cloud"]}
        _cache = c
        today = datetime.date.today()
        print(f"[WEATHER] Fetched {len(c)} entries")
        for h in sorted(set(k[1] for k in c if k[0] == today)):
            e = c.get((today, h))
            if e:
                print(f"  h{h:02d}: GHI={e['ghi']:3.0f}W/m2  {e['temp']:4.1f}C  clouds={e['cloud']:2.0f}%")
    except Exception as e:
        print(f"[WEATHER] Fetch failed: {e}")

def get(hour):
    h = int(hour) % 24
    today = datetime.date.today()
    entry = _cache.get((today, h))
    if entry:
        return entry["ghi"], entry["temp"], entry["cloud"]
    return None, None, None

def needs_refresh(hour, day_step):
    global _last_refresh
    h = int(hour) % 24
    if h != _last_refresh and day_step % 12 == 0:
        _last_refresh = h
        return True
    return False


def archive_df(start_date: str, end_date: str):
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
        rows = _parse_rows(data)
        print(f"[WEATHER] Archive: {len(rows)} hours ({start_date} to {end_date})")
        return rows
    except Exception as e:
        print(f"[WEATHER] Archive fetch failed: {e}")
        return []


def ml_forecast_df(past_days: int = 3):
    url = WEATHER_ML_URL.format(days=past_days)
    try:
        r = requests.get(url, timeout=10)
        data = r.json()
        rows = _parse_rows(data)
        print(f"[WEATHER] ML data: {len(rows)} hours (past {past_days}d + 2d forecast)")
        return rows
    except Exception as e:
        print(f"[WEATHER] ML data fetch failed: {e}")
        return []


def forecast_df():
    if _forecast_rows:
        return _forecast_rows
    try:
        r = requests.get(WEATHER_URL, timeout=10)
        data = r.json()
        rows = _parse_rows(data)
        print(f"[WEATHER] Forecast: {len(rows)} hours ({rows[0]['ds']} to {rows[-1]['ds']})")
        return rows
    except Exception as e:
        print(f"[WEATHER] Forecast fetch failed: {e}")
        return []
