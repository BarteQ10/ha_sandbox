"""Regression tests for banner output on a legacy Windows console.

The register banner contains non-ASCII characters (e.g. the "->" arrow). On a
Windows console the active code page is often cp1250, which cannot encode
them: `print()` then raises UnicodeEncodeError and the simulator dies in
`main()` before the first tick. `log_setup.setup()` must prevent that.
"""
import io
import sys

from ems_simulator import log_setup, server


def _cp1250_console():
    """A text stream that behaves like a Windows console on code page 1250."""
    return io.TextIOWrapper(io.BytesIO(), encoding="cp1250", errors="strict")


def test_setup_switches_text_streams_to_utf8(monkeypatch):
    stream = _cp1250_console()
    monkeypatch.setattr(sys, "stdout", stream)
    log_setup.setup()
    assert stream.encoding.lower().replace("-", "") == "utf8"
    assert stream.errors == "replace"


def test_banner_prints_on_a_cp1250_console(monkeypatch):
    stream = _cp1250_console()
    monkeypatch.setattr(sys, "stdout", stream)
    log_setup.setup()

    server.banner()  # must not raise UnicodeEncodeError

    stream.flush()
    printed = stream.buffer.getvalue().decode("utf-8")
    assert "EMS SIMULATOR" in printed
    assert "V2G Mode" in printed


def test_force_utf8_ignores_streams_without_reconfigure(monkeypatch):
    # io.StringIO has no reconfigure(); the helper must skip it, not crash.
    monkeypatch.setattr(sys, "stdout", io.StringIO())
    log_setup._force_utf8_streams()
