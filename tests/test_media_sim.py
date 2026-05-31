import random

from ems_simulator.media_sim import _PLAYING_BRIGHTNESS, MediaPlayerSim
from ems_simulator.presence import PRESENCE_AWAY, PRESENCE_HOME


def test_starts_idle():
    m = MediaPlayerSim()
    state, override = m.tick(20.0, PRESENCE_HOME)
    # May or may not start playing (probability-based), state is valid
    assert state in ("idle", "playing", "paused")
    assert m.state == state


def test_stops_when_nobody_home():
    """If playback started, it must stop as soon as presence changes to away."""
    m = MediaPlayerSim()
    m._state = "playing"
    m._ticks = 50

    state, override = m.tick(20.0, PRESENCE_AWAY)
    assert state == "idle"
    assert override is None
    assert m.state == "idle"


def test_brightness_override_only_when_playing():
    m = MediaPlayerSim()
    m._state = "playing"
    m._ticks = 10

    _, override = m.tick(20.0, PRESENCE_HOME)
    if m.state == "playing":
        assert override == _PLAYING_BRIGHTNESS
    else:
        assert override is None


def test_no_override_when_paused():
    m = MediaPlayerSim()
    m._state = "paused"
    m._ticks = 5

    _, override = m.tick(20.0, PRESENCE_HOME)
    assert override is None


def test_brightness_override_property():
    m = MediaPlayerSim()
    m._state = "playing"
    assert m.brightness_override == _PLAYING_BRIGHTNESS

    m._state = "idle"
    assert m.brightness_override is None

    m._state = "paused"
    assert m.brightness_override is None


def test_playing_ends_when_ticks_expire():
    m = MediaPlayerSim()
    m._state = "playing"
    m._ticks = 1

    state, _ = m.tick(20.0, PRESENCE_HOME)
    assert state == "idle"


def test_paused_resumes_when_ticks_expire():
    m = MediaPlayerSim()
    m._state = "paused"
    m._ticks = 1

    state, _ = m.tick(20.0, PRESENCE_HOME)
    assert state == "playing"


def test_playing_triggers_with_probability(monkeypatch):
    monkeypatch.setattr(random, "random", lambda: 0.0)    # always below threshold
    monkeypatch.setattr(random, "randint", lambda a, b: 30)

    m = MediaPlayerSim()
    m._state = "idle"
    state, _ = m.tick(20.0, PRESENCE_HOME)  # evening hour → higher p
    assert state == "playing"


def test_idle_when_random_above_threshold(monkeypatch):
    monkeypatch.setattr(random, "random", lambda: 1.0)  # never triggers

    m = MediaPlayerSim()
    m._state = "idle"
    state, _ = m.tick(20.0, PRESENCE_HOME)
    assert state == "idle"


def test_state_property_matches_tick_return():
    m = MediaPlayerSim()
    state, _ = m.tick(12.0, PRESENCE_HOME)
    assert m.state == state
