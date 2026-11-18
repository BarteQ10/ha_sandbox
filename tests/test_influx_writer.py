"""Tests for the injection-safety regexes guarding read_events() Flux queries,
and for how _connect() decides whether it reached the server.

The regex checks are pure patterns; the connection tests stand a fake client in
for InfluxDBClient — no InfluxDB needed either way.
"""
import ems_simulator.influx_writer as iw
from ems_simulator.influx_writer import _FLUX_RANGE, _SAFE_TAG


def test_flux_range_accepts_relative_durations():
    for v in ["-7d", "-1h", "-30m", "-15s", "-2w", "-90d"]:
        assert _FLUX_RANGE.match(v), v


def test_flux_range_accepts_rfc3339_utc():
    for v in ["2026-05-31T00:00:00Z", "2026-01-01T23:59:59.123Z"]:
        assert _FLUX_RANGE.match(v), v


def test_flux_range_rejects_injection_and_junk():
    bad = [
        "-7d) |> drop()",          # flux injection attempt
        "2026-05-31",              # date without time → not RFC3339 here
        "now()",
        "; malicious",
        "",
        "7d",                      # missing leading minus
        "2026/05/31T00:00:00Z",    # wrong separators
    ]
    for v in bad:
        assert not _FLUX_RANGE.match(v), v


def test_safe_tag_accepts_categories():
    for v in ["anomaly", "rule", "security", "energy", "media", "grid"]:
        assert _SAFE_TAG.match(v), v


def test_safe_tag_rejects_injection():
    for v in ['grid" or "1"=="1', "grid;", "Grid", "grid1", "", "a b"]:
        assert not _SAFE_TAG.match(v), v


# ── _connect(): reaching the server, or deciding it did not ──────────────────

def _fake_client_class(pingable: bool):
    """Stand-in for InfluxDBClient whose ping() answers `pingable`."""
    class _Client:
        def __init__(self, **_kwargs):
            pass

        def write_api(self, **_kwargs):
            return object()

        def ping(self):
            return pingable

        def close(self):
            pass

    return _Client


def _isolated(monkeypatch, pingable: bool):
    monkeypatch.setattr(iw, "InfluxDBClient", _fake_client_class(pingable))
    for name, value in (("_client", None), ("_write", None),
                        ("_failed", False), ("_last_attempt", 0.0)):
        monkeypatch.setattr(iw, name, value)


def test_connect_succeeds_when_the_server_answers_a_ping(monkeypatch):
    _isolated(monkeypatch, pingable=True)

    assert iw._connect() is True
    assert iw._failed is False
    assert iw._write is not None


def test_connect_fails_when_the_server_does_not_answer(monkeypatch):
    """ping() replaced the deprecated health(), which only *logged* a status.

    A server that answered but was not serving therefore counted as connected,
    and every write failed one at a time instead of taking the
    cooldown-and-retry path _failed exists for.
    """
    _isolated(monkeypatch, pingable=False)

    assert iw._connect() is False
    assert iw._failed is True
    assert iw._write is None


def test_connect_does_not_call_the_deprecated_health_api(monkeypatch):
    """health() warns on every single reconnect attempt."""
    _isolated(monkeypatch, pingable=True)
    called: list = []

    client_cls = _fake_client_class(True)
    client_cls.health = lambda self: called.append(True)
    monkeypatch.setattr(iw, "InfluxDBClient", client_cls)

    iw._connect()

    assert called == []
