import ems_simulator.notifications as notify


def _reset():
    """Reset module state between tests."""
    notify._edge.clear()
    notify.set_enabled(True)


# ── runtime master switch ─────────────────────────────────────────────────────

def test_default_enabled():
    _reset()
    assert notify.is_enabled() is True


def test_set_enabled_toggles():
    _reset()
    notify.set_enabled(False)
    assert notify.is_enabled() is False
    notify.set_enabled(True)
    assert notify.is_enabled() is True


def test_set_enabled_coerces_to_bool():
    _reset()
    notify.set_enabled(0)
    assert notify.is_enabled() is False
    notify.set_enabled(1)
    assert notify.is_enabled() is True


# ── channel configuration status ──────────────────────────────────────────────

def test_status_keys():
    _reset()
    s = notify.status()
    assert set(s.keys()) == {"enabled", "webhook", "telegram"}


def test_status_reflects_enable_flag():
    _reset()
    notify.set_enabled(False)
    assert notify.status()["enabled"] is False


def test_webhook_configured_false_by_default(monkeypatch):
    monkeypatch.setattr(notify, "_WEBHOOK_URL", "")
    assert notify.webhook_configured() is False


def test_webhook_configured_true_when_set(monkeypatch):
    monkeypatch.setattr(notify, "_WEBHOOK_URL", "https://example.com/hook")
    assert notify.webhook_configured() is True


def test_telegram_configured_needs_both(monkeypatch):
    monkeypatch.setattr(notify, "_TELEGRAM_TOKEN", "abc")
    monkeypatch.setattr(notify, "_TELEGRAM_CHAT_ID", "")
    assert notify.telegram_configured() is False
    monkeypatch.setattr(notify, "_TELEGRAM_CHAT_ID", "123")
    assert notify.telegram_configured() is True


# ── send respects master switch ───────────────────────────────────────────────

def test_send_skipped_when_disabled(monkeypatch):
    _reset()
    calls = []
    monkeypatch.setattr(notify, "_send_webhook", lambda m, s: calls.append(("w", m)))
    monkeypatch.setattr(notify, "_send_telegram", lambda m, s: calls.append(("t", m)))
    notify.set_enabled(False)
    notify.send("hello")
    assert calls == []


def test_send_fires_when_enabled(monkeypatch):
    _reset()
    calls = []
    monkeypatch.setattr(notify, "_send_webhook", lambda m, s: calls.append(("w", m)))
    monkeypatch.setattr(notify, "_send_telegram", lambda m, s: calls.append(("t", m)))
    notify.set_enabled(True)
    notify.send("hello")
    assert ("w", "hello") in calls
    assert ("t", "hello") in calls


# ── send_test bypasses the master switch ──────────────────────────────────────

def test_send_test_bypasses_disabled(monkeypatch):
    _reset()
    calls = []
    monkeypatch.setattr(notify, "_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.setattr(notify, "_TELEGRAM_TOKEN", "abc")
    monkeypatch.setattr(notify, "_TELEGRAM_CHAT_ID", "123")
    monkeypatch.setattr(notify, "_send_webhook", lambda m, s: calls.append("w"))
    monkeypatch.setattr(notify, "_send_telegram", lambda m, s: calls.append("t"))
    notify.set_enabled(False)  # disabled — test should still fire
    attempted = notify.send_test()
    assert attempted == {"webhook": True, "telegram": True}
    assert calls == ["w", "t"]


def test_send_test_only_configured_channels(monkeypatch):
    _reset()
    calls = []
    monkeypatch.setattr(notify, "_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.setattr(notify, "_TELEGRAM_TOKEN", "")
    monkeypatch.setattr(notify, "_TELEGRAM_CHAT_ID", "")
    monkeypatch.setattr(notify, "_send_webhook", lambda m, s: calls.append("w"))
    monkeypatch.setattr(notify, "_send_telegram", lambda m, s: calls.append("t"))
    attempted = notify.send_test()
    assert attempted == {"webhook": True, "telegram": False}
    assert calls == ["w"]


# ── edge-triggered send_if_changed ────────────────────────────────────────────

def test_send_if_changed_fires_on_rising_edge(monkeypatch):
    _reset()
    sent = []
    monkeypatch.setattr(notify, "send", lambda m, s="info": sent.append(m))
    notify.send_if_changed("k", "alert", condition=False)  # no edge
    assert sent == []
    notify.send_if_changed("k", "alert", condition=True)   # rising edge
    assert sent == ["alert"]
    notify.send_if_changed("k", "alert", condition=True)   # sustained — no repeat
    assert sent == ["alert"]
