from ems_simulator.presence import (
    PRESENCE_AWAY,
    PRESENCE_HOME,
    PRESENCE_VACATION,
    PresenceManager,
)


def test_initial_mode_is_home():
    p = PresenceManager()
    assert p.mode == PRESENCE_HOME
    assert p.label == "home"


def test_update_changes_mode():
    p = PresenceManager()
    p.update(PRESENCE_AWAY)
    assert p.mode == PRESENCE_AWAY
    assert p.label == "away"

    p.update(PRESENCE_VACATION)
    assert p.mode == PRESENCE_VACATION
    assert p.label == "vacation"

    p.update(PRESENCE_HOME)
    assert p.mode == PRESENCE_HOME


def test_invalid_mode_defaults_to_home():
    p = PresenceManager()
    p.update(PRESENCE_AWAY)
    p.update(99)  # invalid
    assert p.mode == PRESENCE_HOME


def test_load_multipliers():
    p = PresenceManager()

    p.update(PRESENCE_HOME)
    assert p.load_multiplier() == 1.0

    p.update(PRESENCE_AWAY)
    assert p.load_multiplier() == 0.35

    p.update(PRESENCE_VACATION)
    assert p.load_multiplier() == 0.15


def test_no_spurious_log_on_same_mode(caplog):
    p = PresenceManager()
    p.update(PRESENCE_HOME)   # already home — should not log
    assert "[PRESENCE]" not in caplog.text
