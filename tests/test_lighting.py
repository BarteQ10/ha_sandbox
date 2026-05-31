import pytest
from ems_simulator.lighting import CircadianModel, CT_COOL_K, CT_WARM_K
from ems_simulator.presence import PRESENCE_AWAY, PRESENCE_HOME, PRESENCE_VACATION


def _tick(hour, presence=PRESENCE_HOME, media_override=None):
    m = CircadianModel()
    m.tick(hour, presence, media_override)
    return m


# ── brightness curve ──────────────────────────────────────────────────────────

def test_night_is_dark():
    m = _tick(2.0)
    assert m.brightness == 0.0


def test_midday_is_full():
    m = _tick(13.0)
    assert m.brightness == 100.0


def test_evening_dims():
    m_early = _tick(19.0)
    m_late  = _tick(22.0)
    assert m_late.brightness < m_early.brightness


def test_brightness_never_negative():
    for h in range(24):
        assert _tick(float(h)).brightness >= 0.0


# ── colour temperature ────────────────────────────────────────────────────────

def test_night_is_warm():
    assert _tick(3.0).color_temp_k == CT_WARM_K


def test_midday_is_cool():
    assert _tick(13.0).color_temp_k == CT_COOL_K


def test_ct_in_valid_range():
    for h in range(24):
        ct = _tick(float(h)).color_temp_k
        assert CT_WARM_K <= ct <= CT_COOL_K


# ── presence modes ────────────────────────────────────────────────────────────

def test_away_turns_lights_off():
    m = _tick(14.0, PRESENCE_AWAY)
    assert m.brightness == 0.0
    assert m.load_w == 0


def test_vacation_lights_off_daytime():
    m = _tick(10.0, PRESENCE_VACATION)
    assert m.brightness == 0.0


def test_vacation_lights_on_evening():
    m = _tick(20.0, PRESENCE_VACATION)
    assert m.brightness > 0.0


# ── media override ────────────────────────────────────────────────────────────

def test_media_dims_lights_when_on():
    normal  = _tick(20.0, PRESENCE_HOME, media_override=None)
    dimmed  = _tick(20.0, PRESENCE_HOME, media_override=25.0)
    assert dimmed.brightness <= 25.0
    assert dimmed.brightness <= normal.brightness


def test_media_override_ignored_when_lights_off():
    m = _tick(3.0, PRESENCE_HOME, media_override=25.0)
    assert m.brightness == 0.0  # night — lights off anyway


def test_media_override_ignored_when_away():
    m = _tick(20.0, PRESENCE_AWAY, media_override=25.0)
    assert m.brightness == 0.0  # away — no lights


# ── load_w ────────────────────────────────────────────────────────────────────

def test_load_proportional_to_brightness():
    m_dim  = _tick(22.0)   # dim evening
    m_full = _tick(13.0)   # full midday
    assert m_dim.load_w < m_full.load_w


def test_load_zero_when_dark():
    assert _tick(3.0).load_w == 0
