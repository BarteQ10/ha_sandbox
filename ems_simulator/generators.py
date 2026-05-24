import random
import math
import datetime

from ems_simulator.config import (PV_PEAK_KW, INVERTER_MAX_W,
    SPIKE_CHANCE, SPIKE_WATTS, SPIKE_MAX_TICKS,
    DEVICE_MIN_ON_SIM_MIN, DEVICE_MIN_OFF_SIM_MIN, TICK_S,
    SOILING_BASE_SUMMER, SOILING_BASE_WINTER, SNOW_EVENT_CHANCE, SNOW_RECOVERY_TICKS,
    HP_COP_CURVE,
    EV_ARRIVAL_HOUR, EV_DEPARTURE_HOUR, EV_DAILY_KWH_NEEDED, EV_CHARGE_MAX_W,
    SCHEDULED_APPLIANCES, PRIORITY_ORDER)

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
                print(f"[SNOW] Snow cover — PV output reduced to 30% for ~2h sim")
            else:
                self._factor = base - random.uniform(0, 0.05)
        elif month in [3, 4, 10, 11]:
            self._factor = (SOILING_BASE_SUMMER + SOILING_BASE_WINTER) / 2 - random.uniform(0, 0.03)
        else:
            self._factor = SOILING_BASE_SUMMER - random.uniform(0, 0.02)

    @property
    def factor(self):
        return self._factor


def pv_from_ghi(ghi, hour, soiling=None):
    if ghi is not None:
        w = int(ghi * PV_PEAK_KW) + random.gauss(0, 50)
        w = max(0, w)
    else:
        w = _pv_synthetic_fallback(hour)
    if w > INVERTER_MAX_W:
        clip_save = w - INVERTER_MAX_W
        w = INVERTER_MAX_W
        if random.random() < 0.005:
            print(f"[CLIP] Inverter clipped {clip_save}W ({int(clip_save/w*100)}%)")
    if soiling is not None:
        w = int(w * soiling.factor)
    return w

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
    for i in range(len(HP_COP_CURVE) - 1):
        t1, c1 = HP_COP_CURVE[i]
        t2, c2 = HP_COP_CURVE[i + 1]
        if t1 <= temp <= t2:
            frac = (temp - t1) / (t2 - t1)
            return c1 + frac * (c2 - c1)
    if temp < HP_COP_CURVE[0][0]:
        return HP_COP_CURVE[0][1]
    return HP_COP_CURVE[-1][1]


class EVProfile:
    def __init__(self):
        self._energy_delivered_today = 0.0
        self._last_reset_day = -1

    def tick(self, day_step, hour, ev_override_active):
        sim_day = day_step // 288
        if sim_day != self._last_reset_day:
            self._energy_delivered_today = 0.0
            self._last_reset_day = sim_day
        is_home = hour >= EV_ARRIVAL_HOUR or hour < EV_DEPARTURE_HOUR
        is_plugged = is_home and not ev_override_active
        energy_still_needed = max(0.0, EV_DAILY_KWH_NEEDED - self._energy_delivered_today)
        return is_plugged, energy_still_needed

    def add_energy(self, kwh):
        self._energy_delivered_today += kwh


class ScheduledAppliance:
    def __init__(self, name, power_w, duration_h, window_start, window_end):
        self.name = name
        self.power_w = power_w
        self.duration_h = duration_h
        self.window_start = window_start
        self.window_end = window_end
        self.state = "idle"  # idle / running / done
        self._remaining_ticks = 0

    def tick(self, hour, price_gr):
        if self.state == "done":
            return 0
        if self.state == "running":
            self._remaining_ticks -= 1
            if self._remaining_ticks <= 0:
                self.state = "done"
                print(f"[APPL] {self.name} finished")
                return 0
            return self.power_w
        if self.state == "idle":
            window_active = False
            if self.window_start <= self.window_end:
                window_active = self.window_start <= hour < self.window_end
            else:
                window_active = hour >= self.window_start or hour < self.window_end
            if window_active:
                self.state = "running"
                self._remaining_ticks = int(self.duration_h * 12)
                print(f"[APPL] {self.name} started ({self.power_w}W, {self.duration_h}h)")
                return self.power_w
        return 0


def make_scheduled_appliances():
    return [ScheduledAppliance(*a) for a in SCHEDULED_APPLIANCES]


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
