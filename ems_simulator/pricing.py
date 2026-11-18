import datetime
import logging
import random

from ems_simulator.config import DISTRIBUTION_LOW, DISTRIBUTION_ZONES, PRICE_BANDS
from ems_simulator.http_util import get_json

log = logging.getLogger(__name__)

PSE_URL = "https://api.raporty.pse.pl/api/rce-pln"

# Today's RCE prices in PLN/MWh, one slot per PSE settlement period — 96 quarter
# hours, None where PSE had no data. The Polish market settles per quarter and
# the API serves it that way, so this keeps that resolution instead of averaging
# it into 24 hourly values and throwing the detail away.
# fetch() REBINDS this list instead of mutating it, so it must never be imported
# by value (`from pricing import _price_cache`) -- call get() / hour_average().
PERIODS_PER_HOUR = 4
PERIODS_PER_DAY = 24 * PERIODS_PER_HOUR

_price_cache: list = []
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

        quarters: list[float | None] = [None] * PERIODS_PER_DAY
        for e in entries:
            dtime_str = e["dtime"]
            dt = datetime.datetime.strptime(dtime_str, "%Y-%m-%d %H:%M:%S")
            idx = dt.hour * PERIODS_PER_HOUR + dt.minute // 15
            price_zl_mwh = e["rce_pln"]
            quarters[idx] = price_zl_mwh

        if any(v is not None for v in quarters):
            # Kept at quarter resolution. Averaging into 24 hourly values used to
            # discard the spread *within* an hour, which is where a lot of the
            # arbitrage sits — and it is the resolution the market bills at.
            _price_cache = quarters
            valid = [v for v in quarters if v is not None]
            log.info("[PRICES] Fetched RCE for %s — %d/%d quarter-hour periods",
                     today, len(valid), PERIODS_PER_DAY)
            log.info("  Range: %.0f - %.0f PLN/MWh", min(valid), max(valid))
            for h in range(24):
                row = quarters[h * PERIODS_PER_HOUR:(h + 1) * PERIODS_PER_HOUR]
                if any(v is not None for v in row):
                    log.info("  h%02d: %s gr/kWh  (:00 :15 :30 :45)", h,
                             " ".join(f"{v / 10:5.1f}" if v is not None else "    -"
                                      for v in row))
        else:
            log.warning("[PRICES] No valid data for %s", today)

    except Exception as e:
        log.warning("[PRICES] Fetch failed: %s", e)


def period_index(hour) -> int:
    """Index of the quarter-hour settlement period that `hour` falls in.

    `hour` may be fractional — main's loop passes day_step / STEPS_PER_HOUR, so
    13.25 is 13:15 — and that fraction now selects the period instead of being
    thrown away by int().
    """
    return int((float(hour) % 24) * PERIODS_PER_HOUR)


def get(hour):
    """Price in gr/kWh for the quarter-hour period containing `hour`."""
    idx = period_index(hour)
    if idx < len(_price_cache) and _price_cache[idx] is not None:
        return _price_cache[idx] / 10.0
    return None


def hour_average(hour):
    """Mean price in gr/kWh across the four periods of `hour`, or None.

    For callers that genuinely reason in whole hours (the overnight charge
    window), so they weigh the whole hour rather than whichever quarter they
    happened to land on.
    """
    h = int(hour) % 24
    row = _price_cache[h * PERIODS_PER_HOUR:(h + 1) * PERIODS_PER_HOUR]
    valid = [v for v in row if v is not None]
    if not valid:
        return None
    return sum(valid) / len(valid) / 10.0


def needs_refresh(hour, day_step):
    global _last_refresh
    h = int(hour) % 24
    if h != _last_refresh and day_step % 12 == 0:
        _last_refresh = h
        return True
    return False


def max_today():
    valid = [v for v in _price_cache if v is not None]
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
