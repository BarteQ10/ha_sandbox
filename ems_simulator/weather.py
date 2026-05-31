import datetime
import logging

from ems_simulator.config import LAT, LON, WEATHER_ML_URL, WEATHER_URL
from ems_simulator.http_util import get_json

log = logging.getLogger(__name__)

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
        data = get_json(WEATHER_URL, timeout=10)
        rows = _parse_rows(data)
        _forecast_rows = rows
        c = {}
        for row in rows:
            d = row["ds"].date()
            h = row["ds"].hour
            c[(d, h)] = {"ghi": row["ghi"], "temp": row["temp"], "cloud": row["cloud"]}
        _cache = c
        today = datetime.date.today()
        log.info("[WEATHER] Fetched %d entries", len(c))
        for h in sorted({k[1] for k in c if k[0] == today}):
            e = c.get((today, h))
            if e:
                log.info("  h%02d: GHI=%3.0fW/m2  %4.1fC  clouds=%2.0f%%",
                         h, e['ghi'], e['temp'], e['cloud'])
    except Exception as e:
        log.warning("[WEATHER] Fetch failed: %s", e)

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
        data = get_json(url, timeout=10)
        rows = _parse_rows(data)
        log.info("[WEATHER] Archive: %d hours (%s to %s)", len(rows), start_date, end_date)
        return rows
    except Exception as e:
        log.warning("[WEATHER] Archive fetch failed: %s", e)
        return []


def ml_forecast_df(past_days: int = 3):
    url = WEATHER_ML_URL.format(days=past_days)
    try:
        data = get_json(url, timeout=10)
        rows = _parse_rows(data)
        log.info("[WEATHER] ML data: %d hours (past %dd + 2d forecast)", len(rows), past_days)
        return rows
    except Exception as e:
        log.warning("[WEATHER] ML data fetch failed: %s", e)
        return []


def forecast_df():
    if _forecast_rows:
        return _forecast_rows
    try:
        data = get_json(WEATHER_URL, timeout=10)
        rows = _parse_rows(data)
        log.info("[WEATHER] Forecast: %d hours (%s to %s)", len(rows), rows[0]['ds'], rows[-1]['ds'])
        return rows
    except Exception as e:
        log.warning("[WEATHER] Forecast fetch failed: %s", e)
        return []
