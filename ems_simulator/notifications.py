"""Notification bridge — generic webhook and Telegram support for EMS alerts.

Configure via environment variables:
  EMS_WEBHOOK_URL          — POST JSON {"text": "...", "severity": "..."} to this URL
  EMS_TELEGRAM_TOKEN       — Telegram bot token
  EMS_TELEGRAM_CHAT_ID     — Telegram chat / channel ID

Notifications are edge-triggered: send_if_changed() only fires when a condition
transitions from False to True, so a sustained alert is not spammed every tick.
"""
import logging
import os

import requests

log = logging.getLogger(__name__)

_WEBHOOK_URL      = os.environ.get("EMS_WEBHOOK_URL", "")
_TELEGRAM_TOKEN   = os.environ.get("EMS_TELEGRAM_TOKEN", "")
_TELEGRAM_CHAT_ID = os.environ.get("EMS_TELEGRAM_CHAT_ID", "")
_TIMEOUT_S        = 5

_EMOJIS = {"info": "ℹ️", "warning": "⚠️", "critical": "🚨"}

# Edge-detection state (key → last bool)
_edge: dict[str, bool] = {}

# Runtime master switch — toggled from HA via Modbus register 20.
# Defaults to True so env-configured channels work out of the box.
_runtime_enabled = True


def webhook_configured() -> bool:
    return bool(_WEBHOOK_URL)


def telegram_configured() -> bool:
    return bool(_TELEGRAM_TOKEN and _TELEGRAM_CHAT_ID)


def enabled() -> bool:
    """Return True if at least one channel is configured (regardless of toggle)."""
    return webhook_configured() or telegram_configured()


def is_enabled() -> bool:
    """Return True if the runtime master switch is on."""
    return _runtime_enabled


def set_enabled(flag: bool) -> None:
    """Set the runtime master switch (called each tick from the Modbus register)."""
    global _runtime_enabled
    flag = bool(flag)
    if flag != _runtime_enabled:
        log.info("[NOTIFY] Notifications %s", "enabled" if flag else "disabled")
        _runtime_enabled = flag


def status() -> dict[str, bool]:
    """Channel configuration + runtime status, for telemetry / UI."""
    return {
        "enabled": _runtime_enabled,
        "webhook": webhook_configured(),
        "telegram": telegram_configured(),
    }


def send(message: str, severity: str = "info") -> None:
    """Send a notification via all configured channels (respects the master switch)."""
    if not _runtime_enabled:
        return
    log.info("[NOTIFY] %s — %s", severity.upper(), message)
    _send_webhook(message, severity)
    _send_telegram(message, severity)


def send_test() -> dict[str, bool]:
    """Send a test message to every configured channel, bypassing the master switch.

    Returns which channels were attempted, so the caller can report back to the UI.
    """
    msg = "Test notification from EMS Simulator — channels are working."
    attempted = {"webhook": webhook_configured(), "telegram": telegram_configured()}
    log.info("[NOTIFY] Sending test notification (webhook=%s telegram=%s)",
             attempted["webhook"], attempted["telegram"])
    if attempted["webhook"]:
        _send_webhook(msg, "info")
    if attempted["telegram"]:
        _send_telegram(msg, "info")
    return attempted


def send_if_changed(key: str, message: str, condition: bool, severity: str = "info") -> None:
    """Send only when condition transitions False → True (edge-triggered)."""
    was = _edge.get(key, False)
    if condition and not was:
        send(message, severity)
    _edge[key] = bool(condition)


def _send_webhook(message: str, severity: str) -> None:
    if not _WEBHOOK_URL:
        return
    try:
        requests.post(
            _WEBHOOK_URL,
            json={"text": f"[EMS {severity.upper()}] {message}", "severity": severity},
            timeout=_TIMEOUT_S,
        )
    except Exception as e:
        log.warning("[NOTIFY] Webhook failed: %s", e)


def _send_telegram(message: str, severity: str) -> None:
    if not _TELEGRAM_TOKEN or not _TELEGRAM_CHAT_ID:
        return
    emoji = _EMOJIS.get(severity, "ℹ️")
    text = f"{emoji} <b>EMS Alert</b>\n{message}"
    try:
        requests.post(
            f"https://api.telegram.org/bot{_TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": _TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=_TIMEOUT_S,
        )
    except Exception as e:
        log.warning("[NOTIFY] Telegram failed: %s", e)
