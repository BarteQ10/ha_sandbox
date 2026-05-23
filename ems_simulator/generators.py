import random
import math

from ems_simulator.config import PV_PEAK_KW, SPIKE_CHANCE, SPIKE_WATTS, SPIKE_MAX_TICKS

def pv_from_ghi(ghi, hour):
    if ghi is not None:
        w = int(ghi * PV_PEAK_KW) + random.gauss(0, 50)
        return max(0, w)
    return _pv_synthetic_fallback(hour)

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


def controllable_load(boiler, hp, ev_limit):
    total = 0
    if boiler == 1:
        total += 3000
    if hp == 1:
        total += 1500
    elif hp == 2:
        total += 3000
    if ev_limit > 0:
        total += min(ev_limit, 7400)
    return total
