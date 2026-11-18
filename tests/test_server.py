"""Regression tests for banner output on a legacy Windows console.

The register banner contains non-ASCII characters (e.g. the "->" arrow). On a
Windows console the active code page is often cp1250, which cannot encode
them: `print()` then raises UnicodeEncodeError and the simulator dies in
`main()` before the first tick. `log_setup.setup()` must prevent that.
"""
import io
import sys

import pytest

from ems_simulator import log_setup, server
from ems_simulator.config import NUM_REGISTERS

# The other side of server.OUTPUT_REGISTERS / SHARED_REGISTERS: what Home
# Assistant writes and the simulator only ever reads.
HA_OWNED_REGISTERS = (2, 10, 14, 15, 16, 17, 18, 19, 20, 21, 22)


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


# ── register ownership ───────────────────────────────────────────────────────

@pytest.fixture
def zeroed():
    """A clean register file on the module-level data bank."""
    server.server.data_bank.set_holding_registers(0, [0] * NUM_REGISTERS)


def test_every_register_has_exactly_one_owner():
    """The three sets must partition the file.

    A register in none of them is one nobody ever updates; a register in two is
    the read-modify-write race the split was introduced to remove. This also
    fails when NUM_REGISTERS grows and the new register is given no owner.
    """
    owners = (list(server.OUTPUT_REGISTERS) + list(server.SHARED_REGISTERS)
              + list(HA_OWNED_REGISTERS))
    assert sorted(owners) == list(range(NUM_REGISTERS))


def test_write_registers_touches_only_the_addresses_given(zeroed):
    server.write_registers({1: 55, 7: 42})

    regs = server.read()
    assert (regs[1], regs[7]) == (55, 42)
    assert [v for i, v in enumerate(regs) if i not in (1, 7)] == [0] * (NUM_REGISTERS - 2)


def test_set_register_if_unchanged_writes_when_nothing_moved(zeroed):
    server.write_registers({3: 1})          # the value the tick read

    assert server.set_register_if_unchanged(3, 1, 0) is True
    assert server.read()[3] == 0


def test_set_register_if_unchanged_keeps_a_write_that_landed_mid_tick(zeroed):
    """The race itself: HA writes the register after the tick has read it.

    The effective value the simulator computed describes the request it read at
    the top of the tick, so writing it would discard the newer one — which is
    what the user sees as a switch snapping back in the dashboard.
    """
    server.write_registers({3: 0})          # what the tick read
    server.write_registers({3: 1})          # HA asks for the boiler, mid-tick

    assert server.set_register_if_unchanged(3, 0, 0) is False
    assert server.read()[3] == 1            # HA's request survives
