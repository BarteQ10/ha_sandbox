"""Central event log — chronological record of discrete simulation events.

A thread-safe in-memory ring buffer (most recent N events). The main loop calls
record()/record_edge() when something happens; the health server's /events
endpoint serves them to the UI. This closes the observability loop: anomalies,
rules, security, standby cuts, media and grid changes in one timeline.

In-memory only (recent history) — cleared on restart by design.
"""
import threading
import time
from collections import deque

MAX_EVENTS = 500

CATEGORIES = ("anomaly", "rule", "security", "energy", "media", "grid")
SEVERITIES = ("info", "warning", "critical")

_events: deque[dict] = deque(maxlen=MAX_EVENTS)
_lock = threading.Lock()
_edge: dict[str, bool] = {}
_seq = 0


def record(category: str, severity: str, message: str) -> None:
    """Append a discrete event to the log."""
    global _seq
    with _lock:
        _seq += 1
        _events.append({
            "id": _seq,
            "ts": time.time(),
            "category": category,
            "severity": severity,
            "message": message,
        })


def record_edge(key: str, category: str, severity: str, message: str, condition: bool) -> None:
    """Record an event only on a False → True transition of `condition`.

    Prevents a sustained level signal (e.g. an active anomaly) from spamming the
    log every tick.
    """
    was = _edge.get(key, False)
    if condition and not was:
        record(category, severity, message)
    _edge[key] = bool(condition)


def snapshot(limit: int = 100, category: str | None = None, since: float | None = None) -> list[dict]:
    """Return recent events, newest first.

    Args:
        limit:    max number of events to return (1-MAX_EVENTS)
        category: filter to one category, or None/"all" for everything
        since:    only events with ts > since (epoch seconds)
    """
    limit = max(1, min(int(limit), MAX_EVENTS))
    with _lock:
        items = list(_events)
    if category and category != "all":
        items = [e for e in items if e["category"] == category]
    if since is not None:
        items = [e for e in items if e["ts"] > since]
    items = items[-limit:]
    items.reverse()  # newest first
    return items


def stats() -> dict:
    """Counts per category + total, for badges / summaries."""
    with _lock:
        items = list(_events)
    counts = dict.fromkeys(CATEGORIES, 0)
    for e in items:
        counts[e["category"]] = counts.get(e["category"], 0) + 1
    return {"total": len(items), "by_category": counts}


def clear() -> None:
    """Reset the log (used in tests)."""
    global _seq
    with _lock:
        _events.clear()
        _edge.clear()
        _seq = 0
