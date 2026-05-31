import datetime
import logging
import math
import random

from ems_simulator.config import (
    DEVICE_MIN_OFF_SIM_MIN,
    DEVICE_MIN_ON_SIM_MIN,
    EV_ARRIVAL_HOUR,
    EV_BATTERY_KWH,
    EV_CHARGE_MAX_W,
    EV_DAILY_KWH_NEEDED,
    EV_DEPARTURE_HOUR,
    HP_COP_CURVE,
    INVERTER_MAX_W,
    LAT,
    PV_PEAK_KW,
    PV_STRINGS,
    SCHEDULED_APPLIANCES,
    SNOW_EVENT_CHANCE,
    SNOW_RECOVERY_TICKS,
    SOILING_BASE_SUMMER,
    SOILING_BASE_WINTER,
    SPIKE_CHANCE,
    SPIKE_MAX_TICKS,
    SPIKE_WATTS,
    STANDBY_CUT_AFTER_TICKS,
    STANDBY_DEVICES,
    STANDBY_RESTORE_AFTER_TICKS,
    STEPS_PER_HOUR,
    TICK_S,
    V2G_MIN_SOC_PCT,
    V2G_POWER_W,
)

log = logging.getLogger(__name__)


class DeviceTimer:
    def __init__(self, min_on_sim_min=None, min_off_sim_min=None):
        self._min_on = (min_on_sim_min if min_on_sim_min is not None else DEVICE_MIN_ON_SIM_MIN) // 5
        self._min_off = (min_off_sim_min if min_off_sim_min is not None else DEVICE_MIN_OFF_SIM_MIN) // 5
        self._remaining = 0
        self._current_value = 0

    def constrain(self, desired):
        was_on = self._current_value > 0
        want_on = desired > 0
        if was_on == want_on:
            if self._remaining > 0:
                self._remaining -= 1
            self._current_value = desired
            return desired
        if was_on and not want_on:
            if self._remaining > 0:
                return self._current_value
            self._remaining = self._min_off
            self._current_value = 0
            return 0
        if self._remaining > 0:
            return 0
        self._remaining = self._min_on
        self._current_value = desired
        return desired

    @property
    def value(self):
        return self._current_value


class SoilingState:
    def __init__(self):
        self._factor = 1.0
        self._snow_ticks = 0

    def tick(self, hour):
        month = datetime.datetime.now().month
        if month in [12, 1, 2]:
            base = SOILING_BASE_WINTER
            if self._snow_ticks > 0:
                self._snow_ticks -= 1
                self._factor = random.uniform(0.3, 0.6)
            elif random.random() < SNOW_EVENT_CHANCE:
                self._snow_ticks = SNOW_RECOVERY_TICKS
                self._factor = 0.3
                log.info("[SNOW] Snow cover — PV output reduced to 30% for ~2h sim")
            else:
                self._factor = base - random.uniform(0, 0.05)
        elif month in [3, 4, 10, 11]:
            self._factor = (SOILING_BASE_SUMMER + SOILING_BASE_WINTER) / 2 - random.uniform(0, 0.03)
        else:
            self._factor = SOILING_BASE_SUMMER - random.uniform(0, 0.02)

    @property
    def factor(self):
        return self._factor


def _poa_factor(hour, tilt_deg, azimuth_deg):
    """Plane-of-array irradiance factor (0-1.5) for a tilted surface.

    Uses basic solar geometry: declination + hour angle → cosine of incidence.
    GHI is the horizontal reference; returns the ratio POA/GHI for the direct
    (beam) component.  Diffuse / ground-reflected components are ignored.

    Args:
        hour:        fractional hour of day (0-23.99)
        tilt_deg:    panel tilt from horizontal (0 = horizontal, 90 = vertical)
        azimuth_deg: panel azimuth (0=North, 90=East, 180=South, 270=West)
    """
    doy = datetime.datetime.now().timetuple().tm_yday
    declination = math.radians(-23.45 * math.cos(math.radians(360 / 365 * (doy + 10))))
    hour_angle = math.radians(15 * (hour - 12))  # 0 at solar noon
    lat = math.radians(LAT)
    tilt = math.radians(tilt_deg)
    # Convert to convention: azimuth relative to south, positive westward
    az = math.radians(azimuth_deg - 180)

    # Cosine of solar zenith angle (sun above horizon when > 0)
    cos_z = math.sin(lat) * math.sin(declination) + math.cos(lat) * math.cos(declination) * math.cos(hour_angle)
    if cos_z <= 0.01:
        return 0.0

    # Cosine of incidence angle on tilted surface
    cos_i = (
        math.sin(declination) * math.sin(lat) * math.cos(tilt)
        - math.sin(declination) * math.cos(lat) * math.sin(tilt) * math.cos(az)
        + math.cos(declination) * math.cos(lat) * math.cos(tilt) * math.cos(hour_angle)
        + math.cos(declination) * math.sin(lat) * math.sin(tilt) * math.cos(az) * math.cos(hour_angle)
        + math.cos(declination) * math.sin(tilt) * math.sin(az) * math.sin(hour_angle)
    )
    return min(max(cos_i, 0.0) / cos_z, 1.5)


def pv_from_ghi(ghi, hour, soiling=None):
    soiling_factor = soiling.factor if soiling is not None else 1.0

    if ghi is not None:
        if PV_STRINGS:
            # Multi-string mode: sum POA-weighted output for each string
            w = 0.0
            for _name, peak_kw, tilt_deg, azimuth_deg in PV_STRINGS:
                factor = _poa_factor(hour, tilt_deg, azimuth_deg)
                w += ghi * factor * peak_kw * 1000  # W
            w = w * soiling_factor + random.gauss(0, 50)
        else:
            w = ghi * PV_PEAK_KW * 1000 * soiling_factor + random.gauss(0, 50)
        w = max(0.0, w)
    else:
        w = _pv_synthetic_fallback(hour)

    if w > INVERTER_MAX_W:
        clip_save = w - INVERTER_MAX_W
        w = INVERTER_MAX_W
        if random.random() < 0.005:
            log.info("[CLIP] Inverter clipped %dW (%d%%)", clip_save, int(clip_save / w * 100))
    return int(w)

def _pv_synthetic_fallback(hour):
    if hour < 5 or hour > 20:
        return 0
    angle = math.pi * (hour - 5) / 15
    base = 5000 * max(0, math.sin(angle))
    base *= 1.0 - random.uniform(0.2, 0.8) * 0.8
    base += random.gauss(0, 80)
    return max(0, int(base))


def base_load(hour, temp):
    if hour < 6:
        b = random.randint(150, 350)
    elif hour < 9:
        b = random.randint(500, 900)
    elif hour < 14:
        b = random.randint(300, 600)
    elif hour < 18:
        b = random.randint(400, 700)
    elif hour < 23:
        b = random.randint(600, 1100)
    else:
        b = random.randint(300, 500)

    if temp is not None:
        if temp < 18:
            b += min(int((18 - temp) * 60), 2000)
        elif temp > 26:
            b += min(int((temp - 26) * 80), 1500)
    return b


class SpikeState:
    def __init__(self):
        self.remaining = 0
        self.power = 0
        self.just_started = False
        self.just_ended = False

    def tick(self):
        self.just_started = False
        self.just_ended = False

        if self.remaining > 0:
            self.remaining -= 1
            if self.remaining <= 0:
                self.power = 0
                self.just_ended = True
            return self.power

        if random.random() < SPIKE_CHANCE:
            self.power = random.choice(SPIKE_WATTS)
            self.remaining = random.randint(1, SPIKE_MAX_TICKS) - 1
            self.just_started = True
            return self.power
        return 0


def hp_cop(temp):
    if temp is None:
        return 3.0
    for (t1, c1), (t2, c2) in zip(HP_COP_CURVE, HP_COP_CURVE[1:], strict=False):
        if t1 <= temp <= t2:
            frac = (temp - t1) / (t2 - t1)
            return c1 + frac * (c2 - c1)
    if temp < HP_COP_CURVE[0][0]:
        return HP_COP_CURVE[0][1]
    return HP_COP_CURVE[-1][1]


class EVProfile:
    def __init__(self):
        self._energy_delivered_today = 0.0
        self._ev_soc_kwh = EV_BATTERY_KWH * 0.2  # start at 20% SoC (just arrived)
        self._last_reset_day = -1

    def tick(self, day_step, hour, ev_override_active):
        sim_day = day_step // 288
        if sim_day != self._last_reset_day:
            self._energy_delivered_today = 0.0
            # EV departs with the energy it accumulated; reset SoC to low on next arrival
            self._ev_soc_kwh = max(0.0, self._ev_soc_kwh - EV_DAILY_KWH_NEEDED)
            self._last_reset_day = sim_day
        is_home = hour >= EV_ARRIVAL_HOUR or hour < EV_DEPARTURE_HOUR
        is_plugged = is_home and not ev_override_active
        energy_still_needed = max(0.0, EV_DAILY_KWH_NEEDED - self._energy_delivered_today)
        return is_plugged, energy_still_needed

    def add_energy(self, kwh):
        self._energy_delivered_today += kwh
        self._ev_soc_kwh = min(EV_BATTERY_KWH, self._ev_soc_kwh + kwh)

    def v2g_tick(self):
        """Discharge EV at V2G_POWER_W for one tick.  Returns actual power (W) or 0."""
        ev_soc_pct = self._ev_soc_kwh / EV_BATTERY_KWH * 100.0
        if ev_soc_pct <= V2G_MIN_SOC_PCT:
            return 0
        kwh_out = V2G_POWER_W * TICK_S * 60.0 / (3600.0 * 1000.0)
        self._ev_soc_kwh = max(0.0, self._ev_soc_kwh - kwh_out)
        return V2G_POWER_W

    def restore_energy(self, kwh):
        self._energy_delivered_today = max(0.0, float(kwh))
        self._ev_soc_kwh = min(EV_BATTERY_KWH, self._ev_soc_kwh + float(kwh))

    @property
    def energy_delivered_today(self):
        return self._energy_delivered_today

    @property
    def ev_soc_pct(self):
        return self._ev_soc_kwh / EV_BATTERY_KWH * 100.0


class ScheduledAppliance:
    def __init__(self, name, power_w, duration_h, window_start, window_end, price_threshold=0):
        self.name = name
        self.power_w = power_w
        self.duration_h = duration_h
        self.window_start = window_start
        self.window_end = window_end
        self.price_threshold = price_threshold  # gr/kWh; 0 = start immediately
        self.state = "idle"  # idle / running / done
        self._remaining_ticks = 0

    def _window_active(self, hour):
        if self.window_start <= self.window_end:
            return self.window_start <= hour < self.window_end
        return hour >= self.window_start or hour < self.window_end

    def _hours_left_in_window(self, hour):
        """Approximate simulated hours remaining in the current window."""
        h = int(hour)
        if self.window_start <= self.window_end:
            return max(0, self.window_end - h)
        # Wrapping window: e.g. 22-6
        if h >= self.window_start:
            return 24 - h + self.window_end
        return self.window_end - h

    def tick(self, hour, price_gr):
        if self.state == "done":
            return 0
        if self.state == "running":
            self._remaining_ticks -= 1
            if self._remaining_ticks <= 0:
                self.state = "done"
                log.info("[APPL] %s finished", self.name)
                return 0
            return self.power_w
        if self.state == "idle" and self._window_active(hour):
            # Start if: no price preference, price is cheap enough, or time is running out
            urgent = self._hours_left_in_window(hour) <= self.duration_h + 1
            cheap = self.price_threshold == 0 or price_gr <= self.price_threshold
            if cheap or urgent:
                self.state = "running"
                self._remaining_ticks = int(self.duration_h * 12)
                reason = "urgent" if urgent and not cheap else "cheap" if cheap else "ok"
                log.info("[APPL] %s started (%dW %.1fh, price=%d/%d gr, %s)",
                         self.name, self.power_w, self.duration_h,
                         price_gr, self.price_threshold, reason)
                return self.power_w
        return 0


def make_scheduled_appliances():
    return [ScheduledAppliance(*a) for a in SCHEDULED_APPLIANCES]


class StandbyDevice:
    """Always-on device with standby / active power states and smart-socket cut logic."""

    def __init__(
        self,
        name: str,
        standby_w: float,
        active_w: float,
        active_start: float,
        active_end: float,
        p_active_per_hour: float,
        cut_threshold_w: float = 0.0,
    ) -> None:
        self.name = name
        self.standby_w = standby_w
        self.active_w = active_w
        self.active_start = active_start
        self.active_end = active_end
        self.cut_threshold_w = cut_threshold_w
        self._p_per_tick = p_active_per_hour / STEPS_PER_HOUR
        self._active_ticks   = 0
        self._standby_ticks  = 0   # consecutive ticks at standby power
        self._cut            = False
        self._cut_remaining  = 0   # ticks until socket auto-restores

    def tick(self, hour: float, presence_mode: int = 0) -> tuple[float, bool]:
        """Advance one tick.  Returns (power_w, cut_just_triggered)."""
        # Socket currently cut — count down to auto-restore
        if self._cut:
            self._cut_remaining -= 1
            if self._cut_remaining <= 0:
                self._cut = False
                self._standby_ticks = 0
                log.info("[STANDBY] %s socket restored", self.name)
            return 0.0, False

        # Active state
        if self._active_ticks > 0:
            self._active_ticks -= 1
            self._standby_ticks = 0
            return self.active_w, False

        # Check for active start
        in_window = self.active_start <= hour < self.active_end or self.active_end == 24.0
        if in_window and random.random() < self._p_per_tick:
            self._active_ticks = random.randint(1, 6)
            self._standby_ticks = 0
            return self.active_w, False

        # Standby
        self._standby_ticks += 1

        # Smart-socket cut: only when nobody is home and device eligible
        away = presence_mode != 0   # 0 = PRESENCE_HOME
        can_cut = (
            self.cut_threshold_w > 0
            and self.standby_w < self.cut_threshold_w
            and away
            and self._standby_ticks >= STANDBY_CUT_AFTER_TICKS
        )
        if can_cut:
            self._cut = True
            self._cut_remaining = STANDBY_RESTORE_AFTER_TICKS
            self._standby_ticks = 0
            log.info("[STANDBY] %s cut by smart socket (%.0fW × %d ticks, away)",
                     self.name, self.standby_w, STANDBY_CUT_AFTER_TICKS)
            return 0.0, True

        return self.standby_w, False

    @property
    def is_cut(self) -> bool:
        return self._cut


def make_standby_devices() -> list[StandbyDevice]:
    return [StandbyDevice(*d) for d in STANDBY_DEVICES]


def standby_load(
    devices: list[StandbyDevice], hour: float, presence_mode: int = 0
) -> tuple[int, set[str]]:
    """Total standby power (W) and set of device names cut this tick.

    Informational — not added to the main simulation load (already in base_load).
    """
    total = 0.0
    cuts: set[str] = set()
    for d in devices:
        w, was_cut = d.tick(hour, presence_mode)
        total += w
        if was_cut:
            cuts.add(d.name)
    return int(total), cuts


def controllable_load(boiler, hp, ev_limit, hp_cop_val=None):
    total = 0
    hp_thermal = 0
    if boiler == 1:
        total += 3000
    if hp == 1:
        total += 1500
        if hp_cop_val:
            hp_thermal = 1500 * hp_cop_val
    elif hp == 2:
        total += 3000
        if hp_cop_val:
            hp_thermal = 3000 * hp_cop_val
    if ev_limit > 0:
        total += min(ev_limit, EV_CHARGE_MAX_W)
    return total, hp_thermal
