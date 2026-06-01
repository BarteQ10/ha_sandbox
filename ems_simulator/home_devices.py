"""Auxiliary smart-home device simulators (MQTT virtual devices, section 8).

A single tick()-driven class that models a handful of common Zigbee/Wi-Fi
gadgets so they appear as real Home Assistant entities via MQTT autodiscovery:

  read-only
    - temperature + humidity sensor          (humidity %, temp via thermal model)
    - water + gas meters                     (monotonic total_increasing m³)
    - window + door contact sensors          (binary_sensor: window / door)
    - leak / smoke / CO safety sensors        (binary_sensor: moisture/smoke/CO)
  controllable (commands arrive over MQTT, no Modbus register used)
    - driveway gate                          (cover, 0–100 % position)
    - entrance lock                          (lock, LOCKED/UNLOCKED)
    - living-room TRV / thermostat            (climate, off|heat + target temp)

None of these feed the EMS control core; they are standalone props that make
the dashboard and the automations feel like a real house.
"""
import logging
import math
import random

log = logging.getLogger(__name__)

# ── tunables (module-level, matching media_sim/lighting style) ─────────────────

_HUMIDITY_BASE   = 45.0   # % mean
_HUMIDITY_SWING  = 8.0    # % daily amplitude (peaks overnight)
_HUMIDITY_MIN    = 25.0
_HUMIDITY_MAX    = 75.0

_GATE_STEP       = 25     # % position change per tick (opens/closes in ~4 ticks)
_TRV_MIN         = 7.0
_TRV_MAX         = 30.0

# event probabilities per tick (TICK = 5 sim-minutes)
_P_WINDOW_OPEN   = 0.010  # start an airing
_P_WINDOW_CLOSE  = 0.060  # end an airing
_P_DOOR_OPEN     = 0.040  # someone uses the door (only when home)
_P_LEAK          = 0.0004
_P_SMOKE         = 0.0002
_P_CO            = 0.0002
_SAFETY_HOLD     = 6       # ticks a safety alarm stays latched before clearing


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _water_litres(hour: float, home: bool) -> float:
    """Litres drawn in one 5-minute tick (morning/evening peaks when home)."""
    if not home:
        return random.uniform(0.0, 0.3)        # fridge defrost, trickles
    if 6 <= hour < 9 or 18 <= hour < 22:        # showers / cooking / dishes
        return random.uniform(4.0, 16.0)
    if 9 <= hour < 18:
        return random.uniform(0.5, 3.0)
    return random.uniform(0.0, 0.5)             # night


def _gas_m3(hour: float, home: bool, trv_mode: str, t_house: float) -> float:
    """m³ burned in one tick: space heating (TRV) + hot water."""
    g = 0.0
    if trv_mode == "heat" and t_house < 21.5:
        g += random.uniform(0.008, 0.022) * (21.5 - t_house) / 3.0
    if home and (6 <= hour < 9 or 18 <= hour < 22):
        g += random.uniform(0.004, 0.012)       # hot water
    return max(0.0, g)


class HomeDevices:
    """Simulates auxiliary smart-home devices and accepts MQTT commands."""

    def __init__(self) -> None:
        # read-only state
        self.humidity = _HUMIDITY_BASE
        self.water_m3 = 0.0
        self.gas_m3 = 0.0
        self.window_living = False     # True = open
        self.door_entrance = False     # True = open
        self.leak = False
        self.smoke = False
        self.co = False
        # controllable state
        self.gate_position = 0         # 0 closed … 100 open
        self._gate_target = 0
        self.lock_locked = True
        self.trv_target = 21.0
        self.trv_mode = "heat"         # "off" | "heat"
        self.trv_current = 21.0
        # internal timers
        self._safety_hold = {"leak": 0, "smoke": 0, "co": 0}

    # ── per-tick advance ──────────────────────────────────────────────────────

    def tick(self, hour: float, presence_mode: int, t_house: float) -> None:
        home = presence_mode == 0   # PRESENCE_HOME

        # humidity — smooth daily curve (wettest before dawn) + small noise
        base = _HUMIDITY_BASE + _HUMIDITY_SWING * math.sin((hour - 3) / 24 * 2 * math.pi)
        self.humidity = round(_clamp(base + random.gauss(0, 1.5), _HUMIDITY_MIN, _HUMIDITY_MAX), 1)

        # thermostat current temperature tracks the house thermal model
        self.trv_current = round(t_house + random.gauss(0, 0.2), 1)

        # utility meters — strictly non-decreasing
        self.water_m3 = round(self.water_m3 + _water_litres(hour, home) / 1000.0, 4)
        self.gas_m3   = round(self.gas_m3 + _gas_m3(hour, home, self.trv_mode, t_house), 5)

        self._tick_contacts(home)
        self._tick_safety()
        self._tick_gate()

    def _tick_contacts(self, home: bool) -> None:
        # window airing — independent of presence
        if self.window_living:
            if random.random() < _P_WINDOW_CLOSE:
                self.window_living = False
        elif random.random() < _P_WINDOW_OPEN:
            self.window_living = True
        # door — only opens (briefly) when someone is home
        if self.door_entrance:
            self.door_entrance = False          # latched for a single tick
        elif home and random.random() < _P_DOOR_OPEN:
            self.door_entrance = True

    def _tick_safety(self) -> None:
        for name, prob in (("leak", _P_LEAK), ("smoke", _P_SMOKE), ("co", _P_CO)):
            held = self._safety_hold[name]
            if held > 0:
                self._safety_hold[name] = held - 1
                if self._safety_hold[name] == 0:
                    setattr(self, name, False)
            elif random.random() < prob:
                setattr(self, name, True)
                self._safety_hold[name] = _SAFETY_HOLD
                log.warning("[DEVICES] %s alarm triggered", name.upper())

    def _tick_gate(self) -> None:
        if self.gate_position < self._gate_target:
            self.gate_position = min(self._gate_target, self.gate_position + _GATE_STEP)
        elif self.gate_position > self._gate_target:
            self.gate_position = max(self._gate_target, self.gate_position - _GATE_STEP)

    def trigger_alarm(self, name: str, hold: int = 8) -> bool:
        """Manually latch a safety sensor ON for `hold` ticks (test endpoint)."""
        key = (name or "").strip().lower()
        if key not in ("leak", "smoke", "co"):
            return False
        setattr(self, key, True)
        self._safety_hold[key] = hold
        log.warning("[DEVICES] %s alarm manually triggered (%d ticks)", key.upper(), hold)
        return True

    # ── command handlers (called from the MQTT bridge) ────────────────────────

    def cmd_gate(self, payload: str) -> None:
        p = payload.strip().upper()
        if p == "OPEN":
            self._gate_target = 100
        elif p == "CLOSE":
            self._gate_target = 0
        elif p == "STOP":
            self._gate_target = self.gate_position
        log.info("[DEVICES] gate command %s → target %d", p, self._gate_target)

    def cmd_gate_position(self, pct: float) -> None:
        self._gate_target = int(_clamp(pct, 0, 100))

    def cmd_lock(self, payload: str) -> None:
        self.lock_locked = payload.strip().upper() == "LOCK"
        log.info("[DEVICES] lock %s", "LOCKED" if self.lock_locked else "UNLOCKED")

    def cmd_climate_temp(self, value: float) -> None:
        self.trv_target = round(_clamp(value, _TRV_MIN, _TRV_MAX), 1)
        log.info("[DEVICES] TRV target → %.1f°C", self.trv_target)

    def cmd_climate_mode(self, mode: str) -> None:
        m = mode.strip().lower()
        if m in ("off", "heat"):
            self.trv_mode = m
            log.info("[DEVICES] TRV mode → %s", m)

    # ── telemetry snapshot for MQTT / Influx ──────────────────────────────────

    def metrics(self) -> dict:
        return {
            "humidity_pct":  self.humidity,
            "water_m3":      self.water_m3,
            "gas_m3":        self.gas_m3,
            "window_living": self.window_living,
            "door_entrance": self.door_entrance,
            "leak_kitchen":  self.leak,
            "smoke":         self.smoke,
            "co":            self.co,
            "gate_position": self.gate_position,
            "lock_entrance": "LOCKED" if self.lock_locked else "UNLOCKED",
            "trv_current":   self.trv_current,
            "trv_target":    self.trv_target,
            "trv_mode":      self.trv_mode,
        }
