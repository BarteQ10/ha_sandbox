from ems_simulator.config import (
    BATTERY_CYCLE_LIFE,
    BATTERY_KWH,
    CALENDAR_AGING_PCT_PER_YEAR,
    INVERTER_EFFICIENCY,
    SOC_DELTA_DENOM,
)

# Force mode constants shared with HA
MODE_AUTO = 0
MODE_FORCE_CHARGE = 1
MODE_FORCE_DISCHARGE = 2
FORCE_RATE_W = 5000  # 5 kW charge/discharge


def soh(calendar_days: float, kwh_throughput: float) -> float:
    """State of Health combining calendar and cycle degradation.

    Returns a factor in [0.70, 1.0]:
      1.00 = new battery (full capacity)
      0.80 = end-of-life by cycle wear (BATTERY_CYCLE_LIFE full cycles)
      0.70 = hard floor (battery unusable)

    calendar_days  — total simulated days elapsed
    kwh_throughput — cumulative kWh that have flowed through the battery
                     (charge + discharge, always positive)

    One full cycle = BATTERY_KWH kWh in + BATTERY_KWH kWh out
                   = 2 * BATTERY_KWH kWh throughput.
    After BATTERY_CYCLE_LIFE full cycles, cycle_fade reaches 0.20 (20%).
    """
    calendar_fade = calendar_days * CALENDAR_AGING_PCT_PER_YEAR / 100.0 / 365.0
    cycle_fade = (kwh_throughput / (2.0 * BATTERY_KWH)) / BATTERY_CYCLE_LIFE * 0.20
    return max(0.70, 1.0 - calendar_fade - cycle_fade)


def delta(balance_w, force_mode, aging_factor=1.0):
    denom = SOC_DELTA_DENOM * aging_factor
    if force_mode == MODE_FORCE_CHARGE:
        return (FORCE_RATE_W * INVERTER_EFFICIENCY) / denom
    if force_mode == MODE_FORCE_DISCHARGE:
        return -(FORCE_RATE_W / INVERTER_EFFICIENCY) / denom
    if balance_w > 0:
        return (balance_w * INVERTER_EFFICIENCY) / denom
    return (balance_w / INVERTER_EFFICIENCY) / denom


def clamp(soc):
    return max(0.0, min(100.0, soc))
