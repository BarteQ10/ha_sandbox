import datetime
import math

from ems_simulator.config import BATTERY_KWH, PV_PEAK_KW
from ems_simulator.loop_logic import step_hours
from ems_simulator.pricing import distribution_rate, fallback_price
from ems_simulator.pricing import hour_average as live_price
from ems_simulator.weather import forecast_df

CHARGE_POWER_KW = 5.0
TARGET_SOC = 90.0


def _price_at_hour(h):
    """Price for hour-of-day `h` in gr/kWh.

    Asks pricing for the live RCE price on every call. Callers must not hold
    the price cache themselves: pricing.fetch() rebinds it, so a captured
    reference stays empty forever and every hour would be synthesized.
    """
    h = int(h) % 24
    rce = live_price(h)
    return rce if rce is not None else float(fallback_price(h))


def compute_charge_window(hour, current_soc, forecast=None):
    """Compute the cheapest overnight charge window.

    forecast — optional dict from ForecastEngine.predict_next_24h().
    When provided, uses its PV and price predictions; falls back to a GHI-based
    PV estimate and the live RCE prices from pricing otherwise.

    Windows are ranked on the effective import price: energy plus that hour's
    distribution rate, the same basis loop_logic, backtest and mpc_scheduler use.
    """
    current_energy = current_soc / 100.0 * BATTERY_KWH
    target_energy = TARGET_SOC / 100.0 * BATTERY_KWH

    # PV tomorrow: prefer ML forecast, fall back to naive GHI-based estimate
    if forecast and "pv" in forecast:
        # W per sample -> kWh needs the sample length: 96 quarter-hour samples
        # summed as if hourly would claim four times the energy.
        pv_tomorrow_kwh = sum(forecast["pv"]) * step_hours(forecast["pv"]) / 1000.0
    else:
        raw = forecast_df()
        if not raw:
            return None, 0, 0.0, 0.0
        tomorrow_d = datetime.date.today() + datetime.timedelta(days=1)
        tomorrow_ghi = [row["ghi"] for row in raw if row["ds"].date() == tomorrow_d]
        if not tomorrow_ghi:
            return None, 0, 0.0, 0.0
        pv_tomorrow_kwh = sum(ghi * PV_PEAK_KW for ghi in tomorrow_ghi) / 1000.0

    energy_needed = max(0.0, target_energy - current_energy - pv_tomorrow_kwh)
    if energy_needed < 0.5:
        return None, 0, 0.0, round(pv_tomorrow_kwh, 1)

    duration_h = math.ceil(energy_needed / CHARGE_POWER_KW)
    night_hours = list(range(22, 24)) + list(range(0, 8))

    # Price per hour: prefer the forecast, fall back to live RCE prices.
    # A short price list (empty weather cache upstream) is treated as absent
    # rather than indexed past its end.
    fc_price = forecast.get("price") if forecast else None
    if fc_price is not None and len(fc_price) >= 24:
        # Index i of a forecast is i *samples* from `hour`, not hour-of-day,
        # because the window starts at "now" (forecasting._weather_future_df).
        # So hour-of-day h sits (h - hour) hours in, which is that many samples
        # once divided by the sample length — 1 h apart at 24 samples, 15 min
        # apart at 96. Indexing by h alone read a curve rotated by the current
        # hour, and at quarter resolution would have read only the first 6 h.
        start = int(hour) % 24
        per_hour = 1.0 / step_hours(fc_price)

        def _price_h(h):
            return fc_price[int(((h - start) % 24) * per_hour)]
    else:
        _price_h = _price_at_hour

    # Price the night once: hours with no data get a synthetic band price, so
    # re-pricing inside the loop would make the window costs incomparable.
    #
    # The distribution rate is added here, not inside the lookups, so both the
    # forecast path and the live-price path pay it. Charging from the grid is an
    # import and is billed for it — and the rate is time-of-use, so inside the
    # night window alone it swings from 12 gr/kWh before 06:00 to 28 gr/kWh
    # after. Ranking windows on the energy price alone made 06:00-08:00 look as
    # cheap as the small hours when it is in fact the peak rate.
    night_price = {h: _price_h(h) + distribution_rate(h) for h in night_hours}

    best_start = None
    best_cost = float("inf")
    for i in range(len(night_hours) - duration_h + 1):
        window = night_hours[i: i + duration_h]
        cost = sum(night_price[h] for h in window)
        if cost < best_cost:
            best_cost = cost
            best_start = window[0]

    return best_start, duration_h, round(energy_needed, 1), round(pv_tomorrow_kwh, 1)
