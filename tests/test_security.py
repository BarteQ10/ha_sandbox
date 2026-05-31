import random

from ems_simulator.presence import PRESENCE_AWAY, PRESENCE_HOME, PRESENCE_VACATION
from ems_simulator.security import MotionSimulator


def test_initial_state_no_motion():
    m = MotionSimulator()
    result = m.tick(10.0, PRESENCE_HOME)
    # May or may not have outdoor motion on first tick (probability-based),
    # but indoor must be False when at home
    assert result["indoor"] is False


def test_indoor_motion_only_when_away(monkeypatch):
    monkeypatch.setattr(random, "random", lambda: 0.0)  # always triggers
    m = MotionSimulator()
    result_home = m.tick(10.0, PRESENCE_HOME)
    assert result_home["indoor"] is False

    m2 = MotionSimulator()
    result_away = m2.tick(10.0, PRESENCE_AWAY)
    assert result_away["indoor"] is True


def test_indoor_motion_also_when_vacation(monkeypatch):
    monkeypatch.setattr(random, "random", lambda: 0.0)
    m = MotionSimulator()
    result = m.tick(10.0, PRESENCE_VACATION)
    assert result["indoor"] is True


def test_outdoor_motion_possible_at_home(monkeypatch):
    monkeypatch.setattr(random, "random", lambda: 0.0)
    m = MotionSimulator()
    result = m.tick(10.0, PRESENCE_HOME)
    assert result["outdoor"] is True


def test_motion_duration_persists(monkeypatch):
    """Once motion triggers it stays True for _active_remaining ticks."""
    call_count = [0]

    def controlled_random():
        call_count[0] += 1
        # Trigger on tick 1, never again
        return 0.0 if call_count[0] == 1 else 1.0

    monkeypatch.setattr(random, "random", controlled_random)
    monkeypatch.setattr(random, "randint", lambda a, b: 1)  # active for 1 extra tick

    m = MotionSimulator()
    r1 = m.tick(10.0, PRESENCE_HOME)  # triggers, remaining set to 1
    r2 = m.tick(10.0, PRESENCE_HOME)  # remaining decrements to 0, still True
    r3 = m.tick(10.0, PRESENCE_HOME)  # remaining=0, next random=1.0 → no trigger

    assert r1["outdoor"] is True
    assert r2["outdoor"] is True
    assert r3["outdoor"] is False


def test_return_dict_has_correct_keys():
    m = MotionSimulator()
    result = m.tick(12.0, PRESENCE_HOME)
    assert set(result.keys()) == {"outdoor", "indoor"}


def test_indoor_clears_when_back_home(monkeypatch):
    monkeypatch.setattr(random, "random", lambda: 0.0)
    monkeypatch.setattr(random, "randint", lambda a, b: 5)
    m = MotionSimulator()
    m.tick(10.0, PRESENCE_AWAY)              # triggers indoor

    # Return home — indoor must be cleared
    result = m.tick(10.0, PRESENCE_HOME)
    assert result["indoor"] is False
    assert m._indoor_remaining == 0
