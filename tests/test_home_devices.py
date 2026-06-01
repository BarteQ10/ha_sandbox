import random

from ems_simulator.home_devices import _HUMIDITY_MAX, _HUMIDITY_MIN, HomeDevices


def _dev():
    random.seed(1234)
    return HomeDevices()


def _run(dev, n, hour=12.0, presence=0, t_house=21.0):
    for _ in range(n):
        dev.tick(hour, presence, t_house)


# ── gate (cover) ──────────────────────────────────────────────────────────────

def test_gate_opens_fully():
    d = _dev()
    d.cmd_gate("OPEN")
    _run(d, 5)
    assert d.gate_position == 100


def test_gate_closes_fully():
    d = _dev()
    d.cmd_gate("OPEN")
    _run(d, 5)
    d.cmd_gate("CLOSE")
    _run(d, 5)
    assert d.gate_position == 0


def test_gate_stop_holds_position():
    d = _dev()
    d.cmd_gate("OPEN")
    _run(d, 1)                 # one step → 25
    d.cmd_gate("STOP")
    _run(d, 3)
    assert d.gate_position == 25


def test_gate_set_position_clamps():
    d = _dev()
    d.cmd_gate_position(250)   # clamp to 100
    _run(d, 5)
    assert d.gate_position == 100
    d.cmd_gate_position(-50)   # clamp to 0
    _run(d, 5)
    assert d.gate_position == 0


# ── lock ──────────────────────────────────────────────────────────────────────

def test_lock_defaults_locked():
    assert _dev().lock_locked is True


def test_lock_unlock_commands():
    d = _dev()
    d.cmd_lock("UNLOCK")
    assert d.lock_locked is False
    d.cmd_lock("LOCK")
    assert d.lock_locked is True


# ── thermostat (climate) ──────────────────────────────────────────────────────

def test_climate_target_clamped():
    d = _dev()
    d.cmd_climate_temp(99)
    assert d.trv_target == 30.0
    d.cmd_climate_temp(-5)
    assert d.trv_target == 7.0


def test_climate_mode_only_accepts_known():
    d = _dev()
    d.cmd_climate_mode("cool")     # invalid — ignored
    assert d.trv_mode == "heat"
    d.cmd_climate_mode("off")
    assert d.trv_mode == "off"


# ── meters & humidity ─────────────────────────────────────────────────────────

def test_meters_are_monotonic():
    d = _dev()
    prev_w, prev_g = d.water_m3, d.gas_m3
    for _ in range(60):
        d.tick(7.0, 0, 19.0)       # morning, home, cool → both consume
        assert d.water_m3 >= prev_w
        assert d.gas_m3 >= prev_g
        prev_w, prev_g = d.water_m3, d.gas_m3
    assert d.water_m3 > 0
    assert d.gas_m3 > 0


def test_humidity_stays_in_range():
    d = _dev()
    for h in range(0, 24):
        d.tick(float(h), 0, 21.0)
        assert _HUMIDITY_MIN <= d.humidity <= _HUMIDITY_MAX


# ── telemetry snapshot ────────────────────────────────────────────────────────

def test_metrics_has_all_keys():
    keys = set(_dev().metrics().keys())
    assert keys == {
        "humidity_pct", "water_m3", "gas_m3", "window_living", "door_entrance",
        "leak_kitchen", "smoke", "co", "gate_position", "lock_entrance",
        "trv_current", "trv_target", "trv_mode",
        "co2_ppm", "pm25", "voc_index", "air_quality_alert", "doorbell",
        "vacuum_state", "vacuum_battery", "irrigation", "fan_state", "fan_pct",
        "garage_position",
    }


def test_trigger_alarm_latches_then_clears():
    d = _dev()
    assert d.trigger_alarm("smoke") is True
    assert d.smoke is True
    # stays on for the hold window, then clears
    for _ in range(7):
        d.tick(12.0, 0, 21.0)
    assert d.smoke is True
    d.tick(12.0, 0, 21.0)   # 8th tick → hold expires
    assert d.smoke is False


def test_trigger_alarm_rejects_unknown():
    d = _dev()
    assert d.trigger_alarm("explosion") is False
    assert d.trigger_alarm("") is False


# ── robot vacuum ──────────────────────────────────────────────────────────────

def test_vacuum_start_and_drain():
    d = _dev()
    d.cmd_vacuum("start")
    assert d.vacuum_state == "cleaning"
    b0 = d.vacuum_battery
    d.tick(12.0, 0, 21.0)
    assert d.vacuum_battery < b0


def test_vacuum_auto_returns_and_docks_on_low_battery():
    d = _dev()
    d.vacuum_battery = 21
    d.cmd_vacuum("start")
    d.tick(12.0, 0, 21.0)              # drains below 20 → returning
    assert d.vacuum_state == "returning"
    for _ in range(4):
        d.tick(12.0, 0, 21.0)
    assert d.vacuum_state == "docked"


def test_vacuum_charges_while_docked():
    d = _dev()
    d.vacuum_battery = 50
    _run(d, 3)                         # docked by default → charges
    assert d.vacuum_battery > 50


# ── irrigation / fan / garage ──────────────────────────────────────────────────

def test_irrigation_command_and_auto_run():
    d = _dev()
    d.cmd_irrigation("ON")
    assert d.irrigation is True
    d.cmd_irrigation("OFF")
    assert d.irrigation is False
    # auto morning run at 06:00 (not raining)
    d.tick(6.0, 0, 21.0)
    assert d.irrigation is True


def test_irrigation_skips_when_raining():
    d = _dev()
    d.tick(6.0, 0, 21.0, raining=True)
    assert d.irrigation is False


def test_fan_commands():
    d = _dev()
    d.cmd_fan("ON")
    assert d.fan_on is True
    d.cmd_fan_percentage(0)
    assert d.fan_on is False and d.fan_pct == 0
    d.cmd_fan_percentage(75)
    assert d.fan_on is True and d.fan_pct == 75


def test_garage_opens_and_closes():
    d = _dev()
    d.cmd_garage("OPEN")
    _run(d, 4)
    assert d.garage_position == 100
    d.cmd_garage("CLOSE")
    _run(d, 4)
    assert d.garage_position == 0


# ── air quality ─────────────────────────────────────────────────────────────────

def test_air_quality_in_range_and_alert():
    d = _dev()
    for _ in range(20):
        d.tick(12.0, 0, 21.0)
    assert 400 <= d.co2 <= 2000
    assert 0 <= d.pm25 <= 90
    d.co2 = 1500
    assert d.air_quality_alert is True
    d.co2 = 600
    assert d.air_quality_alert is False


def test_new_metrics_keys_present():
    keys = set(_dev().metrics().keys())
    for k in ("co2_ppm", "pm25", "voc_index", "air_quality_alert", "doorbell",
              "vacuum_state", "vacuum_battery", "irrigation", "fan_state",
              "fan_pct", "garage_position"):
        assert k in keys


def test_safety_sensors_default_off():
    d = _dev()
    m = d.metrics()
    assert m["leak_kitchen"] is False
    assert m["smoke"] is False
    assert m["co"] is False
    assert m["lock_entrance"] == "LOCKED"
