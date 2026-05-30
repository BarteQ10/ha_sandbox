import datetime
import logging
import random

from ems_simulator.config import PRICE_BANDS, DISTRIBUTION_ZONES, DISTRIBUTION_LOW
from ems_simulator.http_util import get_json

log = logging.getLogger(__name__)

PSE_URL = "https://api.raporty.pse.pl/api/rce-pln"

_price_cache = {}
_last_refresh = -1


def fetch():
    global _price_cache
    try:
        today = datetime.date.today().isoformat()
        raw = get_json(
            PSE_URL,
            params={"$filter": f"business_date eq '{today}'"},
            timeout=15,
        )
        entries = raw.get("value", raw) if isinstance(raw, dict) else raw

        quarters = [None] * 96
        for e in entries:
            dtime_str = e["dtime"]
            dt = datetime.datetime.strptime(dtime_str, "%Y-%m-%d %H:%M:%S")
            idx = dt.hour * 4 + dt.minute // 15
            price_zl_mwh = e["rce_pln"]
            quarters[idx] = price_zl_mwh

        hourly = []
        for h in range(24):
            q = quarters[h * 4 : (h + 1) * 4]
            valid = [v for v in q if v is not None]
            if len(valid) >= 2:
                avg = sum(valid) / len(valid)
            else:
                avg = None
            hourly.append(avg)

        if any(v is not None for v in hourly):
            _price_cache = hourly
            log.info("[PRICES] Fetched RCE for %s", today)
            log.info("  Range: %.0f - %.0f PLN/MWh",
                     min(v for v in hourly if v), max(v for v in hourly if v))
            for h in range(24):
                if hourly[h] is not None:
                    log.info("  h%02d: %8.2f PLN/MWh  (%.1f gr/kWh)",
                             h, hourly[h], hourly[h] / 10)
        else:
            log.warning("[PRICES] No valid data for %s", today)

    except Exception as e:
        log.warning("[PRICES] Fetch failed: %s", e)


def get(hour):
    h = int(hour) % 24
    if h < len(_price_cache) and _price_cache[h] is not None:
        return _price_cache[h] / 10.0
    return None


def needs_refresh(hour, day_step):
    global _last_refresh
    h = int(hour) % 24
    if h != _last_refresh and day_step % 12 == 0:
        _last_refresh = h
        return True
    return False


def max_today():
    valid = [v for v in _price_cache if v is not None] if isinstance(_price_cache, list) else []
    if valid:
        return max(valid) / 10.0
    return max(hi_p for _, _, _, hi_p in PRICE_BANDS)


def fallback_price(hour):
    for lo_h, hi_h, lo_p, hi_p in PRICE_BANDS:
        if lo_h <= hour < hi_h:
            return random.randint(lo_p, hi_p)
    return random.randint(20, 35)


def distribution_rate(hour):
    h = int(hour) % 24
    for lo_h, hi_h, rate in DISTRIBUTION_ZONES:
        if lo_h <= h < hi_h:
            return rate
    return DISTRIBUTION_LOW
