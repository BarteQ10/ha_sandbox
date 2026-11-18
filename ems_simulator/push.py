"""Web Push notifications (optional).

Stores browser push subscriptions and delivers notifications via the Web Push
protocol (VAPID), so alerts reach a phone/tablet even when the dashboard is
closed. Disabled unless EMS_VAPID_PRIVATE / EMS_VAPID_PUBLIC are set — mirrors
the other optional integrations (Telegram, MQTT, LLM).

  EMS_VAPID_PUBLIC   VAPID public key (also handed to the frontend via /push/key)
  EMS_VAPID_PRIVATE  VAPID private key (secret — keep in .env)
  EMS_VAPID_SUBJECT  contact, mailto: or https URL (default mailto:admin@example.com)
  PUSH_SUBS_PATH     where subscriptions persist (default /data/push_subs.json)

Generate a keypair once with:  python -m ems_simulator.push --gen-keys
"""
import json
import logging
import os
import threading

from ems_simulator.config import PUSH_MAX_SUBSCRIPTIONS

log = logging.getLogger(__name__)

VAPID_PUBLIC = os.environ.get("EMS_VAPID_PUBLIC", "")
VAPID_PRIVATE = os.environ.get("EMS_VAPID_PRIVATE", "")
VAPID_SUBJECT = os.environ.get("EMS_VAPID_SUBJECT", "mailto:admin@example.com")
SUBS_PATH = os.environ.get("PUSH_SUBS_PATH", "/data/push_subs.json")

_subs: list[dict] = []
_lock = threading.Lock()


def enabled() -> bool:
    """True when VAPID keys are configured."""
    return bool(VAPID_PRIVATE and VAPID_PUBLIC)


def _load() -> None:
    global _subs
    try:
        with open(SUBS_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            _subs = [s for s in data if isinstance(s, dict) and s.get("endpoint")]
    except (FileNotFoundError, ValueError, OSError):
        _subs = []


def _save() -> None:
    try:
        os.makedirs(os.path.dirname(SUBS_PATH), exist_ok=True)
        with open(SUBS_PATH, "w", encoding="utf-8") as f:
            json.dump(_subs, f)
    except OSError as e:
        log.warning("[PUSH] could not persist subscriptions: %s", e)


def add_subscription(sub: dict) -> int:
    """Register a browser subscription (deduped by endpoint). Returns total count.

    Capped at PUSH_MAX_SUBSCRIPTIONS: known endpoints keep working, but a new
    one past the cap is dropped rather than growing the list — and the file it
    persists to — without bound.
    """
    endpoint = sub.get("endpoint") if isinstance(sub, dict) else None
    if not endpoint:
        return len(_subs)
    with _lock:
        if not any(s.get("endpoint") == endpoint for s in _subs):
            if len(_subs) >= PUSH_MAX_SUBSCRIPTIONS:
                log.warning("[PUSH] subscription limit reached (%d) — dropping a new one",
                            PUSH_MAX_SUBSCRIPTIONS)
                return len(_subs)
            _subs.append(sub)
            _save()
        return len(_subs)


def send(title: str, body: str, *, tag: str | None = None, url: str = "/") -> int:
    """Deliver a push to every subscription. Prunes expired ones. Returns #sent."""
    if not enabled() or not _subs:
        return 0
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        log.warning("[PUSH] pywebpush not installed")
        return 0

    payload = json.dumps({"title": title, "body": body, "tag": tag, "url": url})
    claims = {"sub": VAPID_SUBJECT}
    sent, dead = 0, []
    for sub in list(_subs):
        try:
            webpush(subscription_info=sub, data=payload,
                    vapid_private_key=VAPID_PRIVATE, vapid_claims=dict(claims))
            sent += 1
        except WebPushException as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code in (404, 410):
                dead.append(sub)   # subscription gone — prune
            else:
                log.warning("[PUSH] send failed (%s): %s", code, e)
        except Exception as e:  # noqa: BLE001 - never let push break the loop
            log.warning("[PUSH] send error: %s", e)
    if dead:
        with _lock:
            _subs[:] = [s for s in _subs if s not in dead]
            _save()
    return sent


_load()


if __name__ == "__main__":  # `python -m ems_simulator.push --gen-keys`
    import base64

    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid01

    v = Vapid01()
    v.generate_keys()

    def _b64(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    priv = _b64(v.private_key.private_numbers().private_value.to_bytes(32, "big"))
    pub = _b64(v.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    print("EMS_VAPID_PUBLIC=" + pub)
    print("EMS_VAPID_PRIVATE=" + priv)
