"""Auxiliary smart-home device simulators (MQTT virtual devices, section 8).

A single tick()-driven class that models a handful of common Zigbee/Wi-Fi
gadgets so they appear as real Home Assistant entities via MQTT autodiscovery:

  read-only
    - temperature + humidity sensor          (humidity %, temp via thermal model)
    - water + gas meters                     (monotonic total_increasing m³)
    - window + door contact sensors          (binary_sensor: window / door)
    - leak / smoke / CO safety sensors        (binary_sensor: moisture/smoke/CO)
    - air-quality sensor                     (CO₂ ppm, PM2.5, VOC index) + alert
    - video doorbell                         (binary_sensor: occupancy, rings briefly)
  controllable (commands arrive over MQTT, no Modbus register used)
    - driveway gate                          (cover, 0–100 % position)
    - garage door                            (cover, 0–100 % position)
    - entrance lock                          (lock, LOCKED/UNLOCKED)
    - living-room TRV / thermostat            (climate, off|heat + target temp)
    - robot vacuum                           (vacuum: start/stop/pause/return + battery)
    - garden irrigation                      (switch; auto morning run, skips rain)
    - living-room fan                        (fan: on/off + speed %)

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

_GARAGE_STEP     = 34      # % position change per tick (opens/closes in ~3 ticks)

# Air quality
_CO2_BASE        = 450     # ppm outdoor baseline
_CO2_ALERT       = 1200    # ppm → air-quality alert on
_CO2_MAX         = 2000

# Robot vacuum
_VAC_DRAIN       = 2.0     # %/tick while cleaning
_VAC_CHARGE      = 5.0     # %/tick while docked
_VAC_LOW_BATT    = 20      # auto-return below this
_VAC_RETURN_TICKS = 3      # ticks spent "returning" before docking

# Irrigation: auto morning run
_IRRIG_HOUR      = 6
_IRRIG_TICKS     = 6       # ~30 sim-minutes

_P_DOORBELL      = 0.012   # chance per tick of someone ringing


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
        # air quality
        self.co2 = float(_CO2_BASE)    # ppm
        self.pm25 = 8.0                # µg/m³
        self.voc = 50.0                # VOC index
        # video doorbell
        self.doorbell = False
        # robot vacuum
        self.vacuum_state = "docked"   # docked|cleaning|returning|paused|idle
        self.vacuum_battery = 100.0
        # garden irrigation
        self.irrigation = False
        # fan
        self.fan_on = False
        self.fan_pct = 60
        # garage door
        self.garage_position = 0       # 0 closed … 100 open
        self._garage_target = 0
        # internal timers
        self._safety_hold = {"leak": 0, "smoke": 0, "co": 0}
        self._doorbell_hold = 0
        self._vac_return = 0
        self._irrig_auto = 0

    # ── per-tick advance ──────────────────────────────────────────────────────

    def tick(self, hour: float, presence_mode: int, t_house: float, raining: bool = False) -> None:
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
        self._tick_air_quality(home)
        self._tick_doorbell()
        self._tick_vacuum()
        self._tick_irrigation(hour, raining)
        self._tick_cover()

    def _tick_air_quality(self, home: bool) -> None:
        # CO₂ rises indoors when occupied and windows are shut; airing/empty clears it.
        target = _CO2_BASE + (350 if home else 40) - (250 if self.window_living else 0)
        self.co2 = round(_clamp(self.co2 + (target - self.co2) * 0.2 + random.gauss(0, 20), _CO2_BASE, _CO2_MAX))
        self.pm25 = round(_clamp(self.pm25 + random.gauss(0, 1.5) + (8 if random.random() < 0.01 else 0), 0, 90), 1)
        self.voc = round(_clamp(self.voc + random.gauss(0, 5), 0, 300))

    def _tick_doorbell(self) -> None:
        if self._doorbell_hold > 0:
            self._doorbell_hold -= 1
            if self._doorbell_hold == 0:
                self.doorbell = False
        elif random.random() < _P_DOORBELL:
            self.doorbell = True
            self._doorbell_hold = 1
            log.info("[DEVICES] Doorbell ring")

    def _tick_vacuum(self) -> None:
        if self.vacuum_state == "cleaning":
            self.vacuum_battery = max(0.0, self.vacuum_battery - _VAC_DRAIN)
            if self.vacuum_battery <= _VAC_LOW_BATT:
                self.vacuum_state = "returning"
                self._vac_return = _VAC_RETURN_TICKS
                log.info("[DEVICES] Vacuum low battery → returning to dock")
        elif self.vacuum_state == "returning":
            self._vac_return -= 1
            if self._vac_return <= 0:
                self.vacuum_state = "docked"
        elif self.vacuum_state == "docked":
            self.vacuum_battery = min(100.0, self.vacuum_battery + _VAC_CHARGE)

    def _tick_irrigation(self, hour: float, raining: bool) -> None:
        # auto morning run, unless it's raining
        if self._irrig_auto > 0:
            self._irrig_auto -= 1
            if self._irrig_auto == 0:
                self.irrigation = False
        elif int(hour) == _IRRIG_HOUR and not self.irrigation and not raining:
            self.irrigation = True
            self._irrig_auto = _IRRIG_TICKS
            log.info("[DEVICES] Irrigation auto-run started")

    def _tick_cover(self) -> None:
        self._tick_gate()
        if self.garage_position < self._garage_target:
            self.garage_position = min(self._garage_target, self.garage_position + _GARAGE_STEP)
        elif self.garage_position > self._garage_target:
            self.garage_position = max(self._garage_target, self.garage_position - _GARAGE_STEP)

    @property
    def air_quality_alert(self) -> bool:
        return self.co2 >= _CO2_ALERT

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

    def cmd_vacuum(self, payload: str) -> None:
        p = payload.strip().lower()
        if p == "start":
            self.vacuum_state = "cleaning"
        elif p == "stop":
            self.vacuum_state = "idle"
        elif p == "pause":
            self.vacuum_state = "paused"
        elif p in ("return_to_base", "return"):
            self.vacuum_state = "returning"
            self._vac_return = _VAC_RETURN_TICKS
        log.info("[DEVICES] vacuum %s → %s", p, self.vacuum_state)

    def cmd_irrigation(self, payload: str) -> None:
        self.irrigation = payload.strip().upper() == "ON"
        self._irrig_auto = 0
        log.info("[DEVICES] irrigation %s", "ON" if self.irrigation else "OFF")

    def cmd_fan(self, payload: str) -> None:
        self.fan_on = payload.strip().upper() == "ON"
        log.info("[DEVICES] fan %s", "ON" if self.fan_on else "OFF")

    def cmd_fan_percentage(self, pct: float) -> None:
        self.fan_pct = int(_clamp(pct, 0, 100))
        self.fan_on = self.fan_pct > 0

    def cmd_garage(self, payload: str) -> None:
        p = payload.strip().upper()
        if p == "OPEN":
            self._garage_target = 100
        elif p == "CLOSE":
            self._garage_target = 0
        elif p == "STOP":
            self._garage_target = self.garage_position

    def cmd_garage_position(self, pct: float) -> None:
        self._garage_target = int(_clamp(pct, 0, 100))

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
            # air quality
            "co2_ppm":       self.co2,
            "pm25":          self.pm25,
            "voc_index":     self.voc,
            "air_quality_alert": self.air_quality_alert,
            # doorbell
            "doorbell":      self.doorbell,
            # vacuum
            "vacuum_state":  self.vacuum_state,
            "vacuum_battery": round(self.vacuum_battery),
            # irrigation
            "irrigation":    "ON" if self.irrigation else "OFF",
            # fan
            "fan_state":     "ON" if self.fan_on else "OFF",
            "fan_pct":       self.fan_pct,
            # garage
            "garage_position": self.garage_position,
        }
