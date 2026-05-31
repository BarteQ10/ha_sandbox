"""
Startup validation for config.py constants.
Called once in main() before the simulation loop starts.
Raises ValueError with a descriptive message on any bad value so
a misconfigured run fails loudly instead of silently producing wrong results.
"""
from __future__ import annotations

import os
from typing import Any


def _check(name: str, value: Any, *, min: float | None = None, max: float | None = None,
           positive: bool = False, choices: list | None = None) -> None:
    if choices is not None and value not in choices:
        raise ValueError(f"config.{name} = {value!r} is not one of {choices}")
    if positive and value <= 0:
        raise ValueError(f"config.{name} = {value} must be > 0")
    if min is not None and value < min:
        raise ValueError(f"config.{name} = {value} must be >= {min}")
    if max is not None and value > max:
        raise ValueError(f"config.{name} = {value} must be <= {max}")


def validate() -> None:
    import ems_simulator.config as c

    # Modbus
    _check("MODBUS_PORT", c.MODBUS_PORT, min=1, max=65535)
    _check("NUM_REGISTERS", c.NUM_REGISTERS, min=1)
    _check("TICK_S", c.TICK_S, positive=True)

    # Location
    _check("LAT", c.LAT, min=-90, max=90)
    _check("LON", c.LON, min=-180, max=180)

    # PV
    _check("PV_PEAK_KW", c.PV_PEAK_KW, positive=True, max=100)
    _check("INVERTER_MAX_W", c.INVERTER_MAX_W, positive=True)

    # Soiling
    _check("SOILING_BASE_SUMMER", c.SOILING_BASE_SUMMER, min=0.0, max=1.0)
    _check("SOILING_BASE_WINTER", c.SOILING_BASE_WINTER, min=0.0, max=1.0)
    _check("SNOW_EVENT_CHANCE", c.SNOW_EVENT_CHANCE, min=0.0, max=1.0)
    _check("SNOW_RECOVERY_TICKS", c.SNOW_RECOVERY_TICKS, min=1)

    # Battery
    _check("BATTERY_KWH", c.BATTERY_KWH, positive=True, max=1000)
    _check("SOC_DELTA_DENOM", c.SOC_DELTA_DENOM, positive=True)
    _check("INVERTER_EFFICIENCY", c.INVERTER_EFFICIENCY, min=0.5, max=1.0)
    _check("CALENDAR_AGING_PCT_PER_YEAR", c.CALENDAR_AGING_PCT_PER_YEAR, min=0.0, max=10.0)

    # COP curve: must be sorted by temperature, COPs > 0
    temps = [t for t, _ in c.HP_COP_CURVE]
    cops = [cop for _, cop in c.HP_COP_CURVE]
    if temps != sorted(temps):
        raise ValueError("config.HP_COP_CURVE temperature entries must be in ascending order")
    if any(cop <= 0 for cop in cops):
        raise ValueError("config.HP_COP_CURVE all COP values must be > 0")
    if len(c.HP_COP_CURVE) < 2:
        raise ValueError("config.HP_COP_CURVE must have at least 2 points")

    # EV
    _check("EV_ARRIVAL_HOUR", c.EV_ARRIVAL_HOUR, min=0, max=23)
    _check("EV_DEPARTURE_HOUR", c.EV_DEPARTURE_HOUR, min=0, max=23)
    _check("EV_DAILY_KWH_NEEDED", c.EV_DAILY_KWH_NEEDED, positive=True)
    _check("EV_CHARGE_MAX_W", c.EV_CHARGE_MAX_W, positive=True)

    # Device timers
    _check("DEVICE_MIN_ON_SIM_MIN", c.DEVICE_MIN_ON_SIM_MIN, min=0)
    _check("DEVICE_MIN_OFF_SIM_MIN", c.DEVICE_MIN_OFF_SIM_MIN, min=0)

    # Spikes
    _check("SPIKE_CHANCE", c.SPIKE_CHANCE, min=0.0, max=1.0)
    _check("SPIKE_MAX_TICKS", c.SPIKE_MAX_TICKS, min=1)
    if not c.SPIKE_WATTS:
        raise ValueError("config.SPIKE_WATTS must not be empty")

    # Distribution zones: must cover 0-24 exactly, no gaps or overlaps
    zones = sorted(c.DISTRIBUTION_ZONES, key=lambda z: z[0])
    prev_end = 0
    for start, end, rate in zones:
        if start != prev_end:
            raise ValueError(
                f"config.DISTRIBUTION_ZONES gap or overlap at hour {prev_end} → {start}"
            )
        if end <= start:
            raise ValueError(f"config.DISTRIBUTION_ZONES end ({end}) <= start ({start})")
        _check(f"DISTRIBUTION_ZONES rate at {start}-{end}", rate, min=0)
        prev_end = end
    if prev_end != 24:
        raise ValueError(f"config.DISTRIBUTION_ZONES must end at 24, ends at {prev_end}")

    # Scheduled appliances (name, power, duration, win_start, win_end, price_threshold)
    for appl in c.SCHEDULED_APPLIANCES:
        name, power, duration = appl[0], appl[1], appl[2]
        if power <= 0:
            raise ValueError(f"SCHEDULED_APPLIANCES[{name!r}] power must be > 0")
        if duration <= 0:
            raise ValueError(f"SCHEDULED_APPLIANCES[{name!r}] duration must be > 0")

    # InfluxDB env vars — warn if defaults are used (not an error, but helpful)
    _warn_default("INFLUX_URL", "http://localhost:8086")
    _warn_default("INFLUX_TOKEN", "ems-token")


def _warn_default(env: str, default: str) -> None:
    import logging
    if os.environ.get(env, default) == default:
        logging.getLogger(__name__).warning(
            "[CONFIG] %s is using the default value — set it in .env for production", env
        )
