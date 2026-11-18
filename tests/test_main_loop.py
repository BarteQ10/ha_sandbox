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

        def push(self, _metrics):
            pass

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
    # Per-tick writers. One test below runs a real tick, and that must not reach
    # a live InfluxDB (the dev stack listens on :8086, so an unstubbed run would
    # write simulator points into the real bucket) or a live Modbus data bank.
    for _writer in [n for n in dir(m) if n.startswith("inf_write")]:
        monkeypatch.setattr(m, _writer, lambda *a, **k: None)
    for _writer in ("srv_write", "srv_set_register"):
        monkeypatch.setattr(m, _writer, lambda *a, **k: None)
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


def _scripted_read(script):
    """srv_read() stub driven by a list of register blocks / exceptions."""
    def _read():
        step = script.pop(0)
        if isinstance(step, list):
            return step
        raise step
    return _read


def test_a_failing_tick_does_not_stop_the_loop(released, monkeypatch):
    # Four failures, but never three in a row: the clean iteration in the
    # middle resets the counter, so the loop must survive all of them. That
    # clean step is a full register block — an empty read is a FAILED tick, not
    # a quiet one, which the next test pins down.
    clean = [0] * cfg.NUM_REGISTERS
    script: list = [RuntimeError("blip"), RuntimeError("blip"), clean,
              RuntimeError("blip"), RuntimeError("blip"), KeyboardInterrupt]

    monkeypatch.setattr(m, "srv_read", _scripted_read(script))

    m.main()  # Ctrl+C is a graceful stop, so main() returns

    assert script == []  # every scripted tick was attempted
    assert sorted(released) == ALL_SUBSYSTEMS


def test_an_empty_read_counts_as_a_failed_tick(released, monkeypatch):
    """A data bank that answers with nothing has to trip the give-up path.

    This used to set the counter back to 0, so a read that never recovered spun
    the loop forever: no telemetry, and no exit for `restart: unless-stopped` to
    act on.
    """
    attempts = []

    def _reads_nothing():
        attempts.append(1)
        return []

    monkeypatch.setattr(m, "srv_read", _reads_nothing)

    with pytest.raises(RuntimeError, match="no registers"):
        m.main()

    assert len(attempts) == 3  # == the patched MAX_CONSECUTIVE_TICK_ERRORS
    assert sorted(released) == ALL_SUBSYSTEMS


def test_an_empty_read_does_not_reset_the_failure_count(released, monkeypatch):
    """An empty read between two raising ticks must not hide the give-up path.

    Three failures in a row, one of them empty: clearing the counter for the
    empty one (as this used to) made a flapping Modbus server unkillable.
    """
    script: list = [RuntimeError("blip"), [], RuntimeError("last straw")]

    monkeypatch.setattr(m, "srv_read", _scripted_read(script))

    with pytest.raises(RuntimeError, match="last straw"):
        m.main()

    assert script == []  # all three were attempted, and the third gave up
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


# ── EV energy is banked only for load the house actually drew ────────────────

def _ev_is_plugged_and_hungry(monkeypatch):
    """Pin the EV side of a tick, so these tests do not depend on the clock.

    main() seeds day_step from the wall clock, so whether the car is plugged in
    (17:00-07:00) and how much PV there is would otherwise decide the outcome.
    """
    monkeypatch.setattr(m.EVProfile, "tick", lambda self, *a: (True, 10.0))
    monkeypatch.setattr(m, "pv_from_ghi", lambda *a, **k: 0)


def test_an_ev_charge_rate_above_the_cap_is_clamped(released, monkeypatch):
    """Register 5 is HA-written and unvalidated.

    controllable_load() caps the load the EV may contribute at EV_CHARGE_MAX_W,
    so an uncapped reg-5 value made the load, the register and the energy
    banked for the tick describe three different charge rates: 65535 counted
    7400 W of load while crediting the car 5.5 kWh.
    """
    _ev_is_plugged_and_hungry(monkeypatch)
    regs = [0] * cfg.NUM_REGISTERS
    regs[1] = 80                         # SoC high, so no shed interferes
    regs[5] = 65535                      # HA writes nonsense into the EV limit
    script: list = [regs, KeyboardInterrupt]
    written: list = []

    monkeypatch.setattr(m, "srv_read", _scripted_read(script))
    monkeypatch.setattr(m, "srv_write", lambda values: written.append(list(values)))

    m.main()

    assert written, "the tick never got as far as writing its registers"
    assert written[-1][5] == cfg.EV_CHARGE_MAX_W


def test_a_shed_ev_is_not_credited_with_the_energy_it_never_drew(released, monkeypatch):
    """The priority shed takes the EV's watts back out of the total load.

    Banking the energy before the shed ran handed the car a full tick of energy
    that nothing in the balance, the cost or the battery paid for, and
    sensor.ems_ev_energy_today grew on the strength of it.
    """
    _ev_is_plugged_and_hungry(monkeypatch)
    regs = [0] * cfg.NUM_REGISTERS
    regs[1] = 5                          # SoC 5% -> under the 20% shed threshold
    regs[5] = 3700                       # EV charging
    script: list = [regs, KeyboardInterrupt]
    banked: list = []
    written: list = []

    monkeypatch.setattr(m, "srv_read", _scripted_read(script))
    monkeypatch.setattr(m, "srv_write", lambda values: written.append(list(values)))
    monkeypatch.setattr(m.EVProfile, "add_energy",
                        lambda self, kwh: banked.append(kwh))

    m.main()

    assert banked == []            # shed, so it drew nothing and banks nothing
    assert written[-1][5] == 0     # and register 5 says so too


# ── the tick keeps to its period ─────────────────────────────────────────────

def test_the_loop_sleeps_to_a_deadline_not_a_fixed_interval(released, monkeypatch):
    """A flat sleep(TICK_S) made the real period TICK_S + the tick's own work.

    The simulated clock then fell steadily behind the real one that
    forecasting._weather_future_df() and weather.get() index from, so index 0
    of the forecast stopped being the step being simulated.
    """
    clock = {"t": 0.0}
    slept: list = []

    def _sleep(seconds):
        slept.append(seconds)
        clock["t"] += seconds

    def _read():
        clock["t"] += 2.0          # every tick "takes" 2 s of wall clock
        if len(slept) >= 3:
            raise KeyboardInterrupt
        return [0] * cfg.NUM_REGISTERS

    monkeypatch.setattr(m.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(m.time, "sleep", _sleep)
    monkeypatch.setattr(m, "srv_read", _read)

    m.main()

    # Each tick is short by the 2 s it spent working, so the period stays TICK_S.
    assert slept == [cfg.TICK_S - 2.0] * 3


def test_a_tick_that_overruns_its_slot_is_not_slept_off(released, monkeypatch):
    """And the deadline restarts from now, rather than catching up in a burst."""
    clock = {"t": 0.0}
    slept: list = []
    ticks = {"n": 0}

    def _read():
        ticks["n"] += 1
        if ticks["n"] > 3:
            raise KeyboardInterrupt
        clock["t"] += cfg.TICK_S * 2      # twice its budget
        return [0] * cfg.NUM_REGISTERS

    monkeypatch.setattr(m.time, "monotonic", lambda: clock["t"])
    monkeypatch.setattr(m.time, "sleep", lambda s: slept.append(s))
    monkeypatch.setattr(m, "srv_read", _read)

    m.main()

    assert slept == []     # no sleep, and no pile-up of owed time either
