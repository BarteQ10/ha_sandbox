import logging

import ems_simulator.notifications as notify


def _reset():
    """Reset module state between tests."""
    notify._edge.clear()
    notify.set_enabled(True)
    notify.set_muted(0)


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
    """Deliberately out-of-contract: set_enabled is declared bool, and the point
    of this test is the defensive bool() inside it, since a Modbus register is an
    int. Hence the narrow ignores — main.py itself passes a real bool."""
    _reset()
    notify.set_enabled(0)  # type: ignore[arg-type]
    assert notify.is_enabled() is False
    notify.set_enabled(1)  # type: ignore[arg-type]
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
    monkeypatch.setattr(notify, "send", lambda m, s="info", category=None: sent.append(m))
    notify.send_if_changed("k", "alert", condition=False)  # no edge
    assert sent == []
    notify.send_if_changed("k", "alert", condition=True)   # rising edge
    assert sent == ["alert"]
    notify.send_if_changed("k", "alert", condition=True)   # sustained — no repeat
    assert sent == ["alert"]


# ── per-category mute mask ────────────────────────────────────────────────────

def test_muted_default_is_zero():
    _reset()
    assert notify.muted_mask() == 0
    assert notify.category_enabled("grid") is True


def test_set_muted_disables_matching_category():
    _reset()
    notify.set_muted(notify.CATEGORY_BITS["battery"])
    assert notify.category_enabled("battery") is False
    assert notify.category_enabled("grid") is True  # other bits unaffected


def test_set_muted_multiple_bits():
    _reset()
    mask = notify.CATEGORY_BITS["grid"] | notify.CATEGORY_BITS["security"]
    notify.set_muted(mask)
    assert notify.category_enabled("grid") is False
    assert notify.category_enabled("security") is False
    assert notify.category_enabled("rules") is True


def test_unknown_or_none_category_always_allowed():
    _reset()
    notify.set_muted(0xFFFF)  # everything known is muted
    assert notify.category_enabled(None) is True
    assert notify.category_enabled("does_not_exist") is True


def test_send_skipped_when_category_muted(monkeypatch):
    _reset()
    calls = []
    monkeypatch.setattr(notify, "_send_webhook", lambda m, s: calls.append(m))
    monkeypatch.setattr(notify, "_send_telegram", lambda m, s: calls.append(m))
    notify.set_muted(notify.CATEGORY_BITS["grid"])
    notify.send("blackout", category="grid")
    assert calls == []                       # muted category → nothing sent
    notify.send("low soc", category="battery")
    assert calls == ["low soc", "low soc"]   # other category still fires


def test_send_if_changed_respects_category(monkeypatch):
    _reset()
    sent = []
    monkeypatch.setattr(notify, "_send_webhook", lambda m, s: sent.append(m))
    monkeypatch.setattr(notify, "_send_telegram", lambda m, s: sent.append(m))
    notify.set_muted(notify.CATEGORY_BITS["security"])
    notify.send_if_changed("motion", "motion!", condition=True, category="security")
    assert sent == []  # rising edge but category muted


# ── delivery failures: visible in the log, and never leaking the credential ───

class _Resp:
    """Minimal stand-in for requests.Response."""

    def __init__(self, status_code=200, text=""):
        self.status_code = status_code
        self.text = text
        self.ok = 200 <= status_code < 300


def _telegram_configured(monkeypatch, token="123456:SECRET-TOKEN"):
    monkeypatch.setattr(notify, "_TELEGRAM_TOKEN", token)
    monkeypatch.setattr(notify, "_TELEGRAM_CHAT_ID", "42")
    return token


def test_a_delivered_webhook_logs_no_warning(monkeypatch, caplog):
    monkeypatch.setattr(notify, "_WEBHOOK_URL", "https://hooks.example.com/abc")
    monkeypatch.setattr(notify.requests, "post", lambda *a, **k: _Resp(200, "ok"))

    with caplog.at_level(logging.WARNING):
        notify._send_webhook("Blackout", "critical")

    assert caplog.text == ""


def test_a_rejected_webhook_is_logged(monkeypatch, caplog):
    """requests does not raise on 4xx/5xx, so the status has to be checked.

    Without the check a rejected alert looked exactly like a delivered one:
    nothing in the log, and status() still reporting the channel as working.
    """
    monkeypatch.setattr(notify, "_WEBHOOK_URL", "https://hooks.example.com/abc")
    monkeypatch.setattr(notify.requests, "post", lambda *a, **k: _Resp(401, "unauthorized"))

    with caplog.at_level(logging.WARNING):
        notify._send_webhook("Blackout", "critical")

    assert "HTTP 401" in caplog.text


def test_a_rejected_webhook_does_not_log_its_url(monkeypatch, caplog):
    """A Slack/Discord webhook URL is itself the secret."""
    url = "https://hooks.slack.com/services/T000/B000/XXXXSECRET"
    monkeypatch.setattr(notify, "_WEBHOOK_URL", url)
    monkeypatch.setattr(notify.requests, "post", lambda *a, **k: _Resp(404, f"no such {url}"))

    with caplog.at_level(logging.WARNING):
        notify._send_webhook("Blackout", "critical")

    assert url not in caplog.text
    assert "<redacted>" in caplog.text


def test_a_rejected_telegram_is_logged_without_the_token(monkeypatch, caplog):
    token = _telegram_configured(monkeypatch)
    monkeypatch.setattr(notify.requests, "post",
                        lambda *a, **k: _Resp(404, f'{{"description":"Not Found: bot{token}"}}'))

    with caplog.at_level(logging.WARNING):
        notify._send_telegram("Blackout", "critical")

    assert "HTTP 404" in caplog.text
    assert "Not Found" in caplog.text   # Telegram's own explanation survives
    assert token not in caplog.text


def test_a_telegram_transport_error_does_not_leak_the_token(monkeypatch, caplog):
    """requests puts the request URL in its exception messages, token and all."""
    token = _telegram_configured(monkeypatch)

    def _boom(*_a, **_k):
        raise RuntimeError(
            f"Max retries exceeded with url: https://api.telegram.org/bot{token}/sendMessage"
        )

    monkeypatch.setattr(notify.requests, "post", _boom)

    with caplog.at_level(logging.WARNING):
        notify._send_telegram("Blackout", "critical")

    assert "Telegram failed" in caplog.text
    assert token not in caplog.text


def test_telegram_escapes_html_in_the_message(monkeypatch):
    """parse_mode=HTML rejects a bare "<" or "&" with a 400 and drops the alert."""
    _telegram_configured(monkeypatch)
    sent: dict = {}

    def _capture(_url, json=None, timeout=None):
        sent.update(json or {})
        return _Resp()

    monkeypatch.setattr(notify.requests, "post", _capture)

    notify._send_telegram("load < 500 W & rising", "info")

    assert "&lt; 500 W &amp; rising" in sent["text"]
    assert "<b>EMS Alert</b>" in sent["text"]   # our own markup is still markup
