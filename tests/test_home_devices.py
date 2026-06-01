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


def test_safety_sensors_default_off():
    d = _dev()
    m = d.metrics()
    assert m["leak_kitchen"] is False
    assert m["smoke"] is False
    assert m["co"] is False
    assert m["lock_entrance"] == "LOCKED"
