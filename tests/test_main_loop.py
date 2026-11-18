"""Tests for the per-tick guard around main()'s simulation loop.

One failing tick must not take the simulator down. The loop gives up only
after MAX_CONSECUTIVE_TICK_ERRORS failures in a row, Ctrl+C still stops it
immediately, and every exit path releases the Modbus socket, the MQTT bridge
and the InfluxDB buffer.
"""
import pytest

import ems_simulator.config as cfg
from ems_simulator import main as m
from ems_simulator.config_validator import validate


class _StubForecastEngine:
    def fit_all(self):
        return None

    def predict_next_24h(self):
        return {"pv": []}

    def summary(self, forecast):
        return {}


@pytest.fixture
def released(monkeypatch):
    """Neutralise the I/O main() does around the loop; lower the error limit to 3.

    Yields the list of subsystems that were shut down, so a test can assert the
    cleanup ran on whichever path it took out of the loop.
    """
    stopped: list[str] = []

    class _StubMQTT:
        def __init__(self, **_kwargs):
            pass

        def start(self):
            pass

        def stop(self):
            stopped.append("mqtt")

    for name in ("_setup_logging", "srv_banner", "srv_start", "inf_start",
                 "w_fetch", "p_fetch"):
        monkeypatch.setattr(m, name, lambda *a, **k: None)
    monkeypatch.setattr(m, "inf_read_events", lambda *a, **k: [])
    # main() hydrates cost/SoC/EV counters from InfluxDB before the loop.
    monkeypatch.setattr(m, "inf_read_last", lambda *a, **k: None)
    monkeypatch.setattr(m, "ForecastEngine", _StubForecastEngine)
    monkeypatch.setattr(m, "MQTTBridge", _StubMQTT)
    monkeypatch.setattr(m, "mqtt_enabled", lambda: False)
    monkeypatch.setattr(m, "srv_stop", lambda: stopped.append("modbus"))
    monkeypatch.setattr(m, "inf_stop", lambda: stopped.append("influx"))
    monkeypatch.setattr(m.events, "set_backends", lambda **k: None)
    monkeypatch.setattr(m.health, "start", lambda: None)
    monkeypatch.setattr(m.health, "stop", lambda: stopped.append("health"))
    monkeypatch.setattr(m.signal, "signal", lambda *a: None)
    monkeypatch.setattr(m.time, "sleep", lambda _s: None)
    # Patch the name bound in main, not in config — main imported it by value.
    monkeypatch.setattr(m, "MAX_CONSECUTIVE_TICK_ERRORS", 3)
    return stopped


ALL_SUBSYSTEMS = ["health", "influx", "modbus", "mqtt"]


def test_a_failing_tick_does_not_stop_the_loop(released, monkeypatch):
    # Four failures, but never three in a row: the clean iteration in the
    # middle resets the counter, so the loop must survive all of them.
    script: list = [RuntimeError("blip"), RuntimeError("blip"), [],
              RuntimeError("blip"), RuntimeError("blip"), KeyboardInterrupt]

    def _flaky_read():
        step = script.pop(0)
        if isinstance(step, list):
            return step
        raise step

    monkeypatch.setattr(m, "srv_read", _flaky_read)

    m.main()  # Ctrl+C is a graceful stop, so main() returns

    assert script == []  # every scripted tick was attempted
    assert sorted(released) == ALL_SUBSYSTEMS


def test_loop_gives_up_after_too_many_consecutive_failures(released, monkeypatch):
    attempts = []

    def _always_fails():
        attempts.append(1)
        raise RuntimeError("modbus is gone")

    monkeypatch.setattr(m, "srv_read", _always_fails)

    with pytest.raises(RuntimeError, match="modbus is gone"):
        m.main()

    assert len(attempts) == 3  # == the patched MAX_CONSECUTIVE_TICK_ERRORS
    assert sorted(released) == ALL_SUBSYSTEMS


def test_keyboard_interrupt_is_not_swallowed_by_the_guard(released, monkeypatch):
    def _interrupted():
        raise KeyboardInterrupt

    monkeypatch.setattr(m, "srv_read", _interrupted)

    m.main()  # would spin forever if the guard caught BaseException

    assert sorted(released) == ALL_SUBSYSTEMS


def test_validator_rejects_a_non_positive_error_limit(monkeypatch):
    # config_validator re-imports config inside validate(), so patch it there.
    monkeypatch.setattr(cfg, "MAX_CONSECUTIVE_TICK_ERRORS", 0)
    with pytest.raises(ValueError, match="MAX_CONSECUTIVE_TICK_ERRORS"):
        validate()
