from ems_simulator.rules import RuleEngine
from ems_simulator.presence import PRESENCE_HOME, PRESENCE_AWAY, PRESENCE_VACATION


class _Appl:
    """Minimal mock for ScheduledAppliance."""
    def __init__(self, name, state):
        self.name = name
        self.state = state


def _eval(rule_engine, hour=10.0, presence=PRESENCE_HOME, appliances=None):
    return rule_engine.evaluate(hour, presence, appliances or [])


# ── laundry_done rule ─────────────────────────────────────────────────────────

def test_laundry_done_fires_when_washer_done():
    r = RuleEngine()
    events = _eval(r, appliances=[_Appl("Washer", "done")])
    keys = {e.key for e in events}
    assert "laundry_done" in keys


def test_laundry_done_not_fired_when_running():
    r = RuleEngine()
    events = _eval(r, appliances=[_Appl("Washer", "running")])
    assert not any(e.key == "laundry_done" for e in events)


def test_laundry_done_clears_when_washer_resets():
    r = RuleEngine()
    _eval(r, appliances=[_Appl("Washer", "done")])     # fire
    events = _eval(r, appliances=[_Appl("Washer", "idle")])  # clear
    assert not any(e.key == "laundry_done" for e in events)


def test_no_washer_no_laundry_alert():
    r = RuleEngine()
    events = _eval(r, appliances=[_Appl("Dishwasher", "done")])
    assert not any(e.key == "laundry_done" for e in events)


# ── window_away rule ──────────────────────────────────────────────────────────

def test_window_away_requires_both_conditions():
    r = RuleEngine()
    # Manually force window open via monkey-patch
    r._window_open = True
    r._window_ticks = 10

    # At home — should NOT fire even with open window
    events = _eval(r, presence=PRESENCE_HOME)
    assert not any(e.key == "window_away" for e in events)

    # Away — should fire
    events = _eval(r, presence=PRESENCE_AWAY)
    assert any(e.key == "window_away" for e in events)


def test_window_away_fires_on_vacation_too():
    r = RuleEngine()
    r._window_open = True
    r._window_ticks = 10
    events = _eval(r, presence=PRESENCE_VACATION)
    assert any(e.key == "window_away" for e in events)


def test_window_away_clears_when_home():
    r = RuleEngine()
    r._window_open = True
    r._window_ticks = 10
    _eval(r, presence=PRESENCE_AWAY)           # fire
    events = _eval(r, presence=PRESENCE_HOME)  # should clear
    assert not any(e.key == "window_away" for e in events)


def test_window_away_clears_when_window_closed():
    r = RuleEngine()
    r._window_open = True
    r._window_ticks = 10
    _eval(r, presence=PRESENCE_AWAY)           # fire
    r._window_open = False
    events = _eval(r, presence=PRESENCE_AWAY)  # window closed — clear
    assert not any(e.key == "window_away" for e in events)


# ── active_keys property ──────────────────────────────────────────────────────

def test_active_keys_reflects_fired_events():
    r = RuleEngine()
    _eval(r, appliances=[_Appl("Washer", "done")])
    assert "laundry_done" in r.active_keys


def test_active_keys_empty_initially():
    assert RuleEngine().active_keys == set()


# ── severity ──────────────────────────────────────────────────────────────────

def test_window_away_is_warning():
    r = RuleEngine()
    r._window_open = True
    r._window_ticks = 10
    events = _eval(r, presence=PRESENCE_AWAY)
    ev = next(e for e in events if e.key == "window_away")
    assert ev.severity == "warning"


def test_laundry_done_is_info():
    r = RuleEngine()
    events = _eval(r, appliances=[_Appl("Washer", "done")])
    ev = next(e for e in events if e.key == "laundry_done")
    assert ev.severity == "info"
