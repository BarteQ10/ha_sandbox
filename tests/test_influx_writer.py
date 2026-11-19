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


# ── writes happen off the tick now ───────────────────────────────────────────

def test_connect_asks_for_batched_writes_not_synchronous(monkeypatch):
    """SYNCHRONOUS made every write an HTTP round trip inside the loop.

    A tick calls this module about ten times, so that was ten blocking requests
    every five seconds — invisible against a local database, and the likeliest
    way for a tick to overrun its budget on a Raspberry Pi.
    """
    from influxdb_client.client.write_api import WriteType

    captured: dict = {}

    class _Client:
        def __init__(self, **_kwargs):
            pass

        def write_api(self, **kwargs):
            captured.update(kwargs)
            return object()

        def ping(self):
            return True

        def close(self):
            pass

    monkeypatch.setattr(iw, "InfluxDBClient", _Client)
    for name, value in (("_client", None), ("_write", None),
                        ("_failed", False), ("_last_attempt", 0.0)):
        monkeypatch.setattr(iw, name, value)

    assert iw._connect() is True
    assert captured["write_options"].write_type is WriteType.batching
    # Without the callbacks a failed batch would be silent: there is no
    # exception at the call site any more.
    assert captured["error_callback"] is iw._on_write_error
    assert captured["retry_callback"] is iw._on_write_retry


def test_a_failed_batch_is_recorded_even_though_nothing_raised(monkeypatch):
    monkeypatch.setattr(iw, "_write", object())
    monkeypatch.setattr(iw, "_failed", False)
    assert iw.healthy() is True

    iw._on_write_error(("bucket", "org", "ns"), "data", RuntimeError("refused"))

    assert iw.healthy() is False


def test_healthy_is_false_before_anything_is_connected(monkeypatch):
    monkeypatch.setattr(iw, "_write", None)
    monkeypatch.setattr(iw, "_failed", False)
    assert iw.healthy() is False


def test_stop_flushes_the_writer_before_closing_the_client(monkeypatch):
    """Order matters: the writer thread holds up to flush_interval of
    telemetry, and closing the client first drops it with the connection."""
    order: list = []

    class _Writer:
        def close(self):
            order.append("writer")

    class _Client:
        def close(self):
            order.append("client")

    monkeypatch.setattr(iw, "_write", _Writer())
    monkeypatch.setattr(iw, "_client", _Client())

    iw.stop()

    assert order == ["writer", "client"]


def test_connect_flushes_an_old_writer_before_replacing_it(monkeypatch):
    """A reconnect must not drop what the previous writer still holds."""
    order: list = []

    class _OldWriter:
        def close(self):
            order.append("old-writer")

    class _OldClient:
        def close(self):
            order.append("old-client")

    class _NewClient:
        def __init__(self, **_kwargs):
            pass

        def write_api(self, **_kwargs):
            return object()

        def ping(self):
            return True

        def close(self):
            pass

    monkeypatch.setattr(iw, "InfluxDBClient", _NewClient)
    monkeypatch.setattr(iw, "_write", _OldWriter())
    monkeypatch.setattr(iw, "_client", _OldClient())
    monkeypatch.setattr(iw, "_last_attempt", 0.0)

    iw._connect()

    assert order == ["old-writer", "old-client"]
