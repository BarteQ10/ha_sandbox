import datetime

import requests

from ems_simulator.config import PRICE_BANDS

PSE_URL = "https://api.raporty.pse.pl/api/rce-pln"

_price_cache = {}
_last_refresh = -1


def fetch():
    global _price_cache
    try:
        today = datetime.date.today().isoformat()
        r = requests.get(
            PSE_URL,
            params={"$filter": f"business_date eq '{today}'"},
            timeout=15,
        )
        raw = r.json()
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
            print(f"[PRICES] Fetched RCE for {today}")
            print(f"  Range: {min(v for v in hourly if v):.0f} - {max(v for v in hourly if v):.0f} PLN/MWh")
            for h in range(24):
                if hourly[h] is not None:
                    print(f"  h{h:02d}: {hourly[h]:8.2f} PLN/MWh  ({hourly[h] / 10:.1f} gr/kWh)")
        else:
            print(f"[PRICES] No valid data for {today}")

    except Exception as e:
        print(f"[PRICES] Fetch failed: {e}")


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
            import random
            return random.randint(lo_p, hi_p)
    return random.randint(20, 35)
