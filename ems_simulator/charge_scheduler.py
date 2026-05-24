import datetime
import math
from ems_simulator.config import BATTERY_KWH, PV_PEAK_KW, PRICE_BANDS
from ems_simulator.weather import forecast_df

CHARGE_POWER_KW = 5.0
TARGET_SOC = 90.0


def _price_at_hour(h, price_cache):
    if isinstance(price_cache, list) and h < len(price_cache) and price_cache[h] is not None:
        return price_cache[h] / 10.0
    for lo_h, hi_h, lo_p, hi_p in PRICE_BANDS:
        if lo_h <= h % 24 < hi_h:
            import random
            return random.randint(lo_p, hi_p)
    return 0


def compute_charge_window(hour, current_soc, price_cache):
    current_energy = current_soc / 100.0 * BATTERY_KWH
    target_energy = TARGET_SOC / 100.0 * BATTERY_KWH

    forecast = forecast_df()
    if not forecast:
        return None, 0, 0.0, 0.0

    today = datetime.date.today()
    tomorrow_d = today + datetime.timedelta(days=1)

    tomorrow_ghi = [row["ghi"] for row in forecast if row["ds"].date() == tomorrow_d]
    if not tomorrow_ghi:
        return None, 0, 0.0, 0.0

    pv_tomorrow_kwh = sum(ghi * PV_PEAK_KW for ghi in tomorrow_ghi) / 1000.0
    energy_needed = max(0.0, target_energy - current_energy - pv_tomorrow_kwh)

    if energy_needed < 0.5:
        return None, 0, 0.0, round(pv_tomorrow_kwh, 1)

    duration_h = math.ceil(energy_needed / CHARGE_POWER_KW)
    night_hours = list(range(22, 24)) + list(range(0, 8))

    best_start = None
    best_cost = float("inf")

    for i in range(len(night_hours) - duration_h + 1):
        window = night_hours[i : i + duration_h]
        cost = sum(_price_at_hour(h, price_cache) for h in window)
        if cost < best_cost:
            best_cost = cost
            best_start = window[0]

    return best_start, duration_h, round(energy_needed, 1), round(pv_tomorrow_kwh, 1)
