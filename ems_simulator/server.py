from pyModbusTCP.server import ModbusServer

from ems_simulator.config import MODBUS_HOST, MODBUS_PORT, NUM_REGISTERS

server = ModbusServer(MODBUS_HOST, port=MODBUS_PORT, no_block=True)

def start():
    server.start()
    server.data_bank.set_holding_registers(0, [0] * NUM_REGISTERS)

def stop():
    server.stop()

def read():
    return server.data_bank.get_holding_registers(0, NUM_REGISTERS)


# The registers the simulator owns outright. Home Assistant owns 2, 10 and
# 14-22, and the simulator must never write those back.
#
# It used to: a tick read the whole block at the top and wrote all
# NUM_REGISTERS at the bottom, echoing the HA-written ones straight out of the
# snapshot. A tick is not short -- its hourly branch refits the forecast,
# solves the MPC and writes to InfluxDB synchronously -- so an HA write that
# landed in between was overwritten with the value read before it, the switch
# visibly snapped back in the dashboard and the command was lost. Register 21
# (the momentary notify trigger) was reset by that block write too, which threw
# away a test-notification request made during the tick; it is now cleared only
# where it is handled.
#
# Registers 3-5 are shared rather than owned: HA writes the request, the
# simulator writes back what the anti-chatter timers and the shed stages
# actually allowed. Those go through set_register_if_unchanged() below.
OUTPUT_REGISTERS = (0, 1, 6, 7, 8, 9, 11, 12, 13)
SHARED_REGISTERS = (3, 4, 5)


def write_registers(values):
    """Write a ``{address: value}`` mapping.

    Only the addresses given are touched, which is the promise a block write of
    NUM_REGISTERS could not make.
    """
    for addr, value in values.items():
        server.data_bank.set_holding_registers(int(addr), [int(value)])


def set_register_if_unchanged(addr, expected, value) -> bool:
    """Write `value` to `addr`, but only while it still reads `expected`.

    For the shared registers above, this keeps a mid-tick write from Home
    Assistant: the effective value the simulator computed describes the request
    it read at the top of the tick, so writing it over a newer request would
    discard that request. Returns True when the value was written, False when
    something else got there first and its value is left for the next tick to
    act on.

    This narrows the window from the whole tick down to the gap between the two
    calls below. pyModbusTCP's data bank has no compare-and-set, so it cannot
    be closed completely.
    """
    current = server.data_bank.get_holding_registers(addr, 1)
    if current and current[0] != int(expected):
        return False
    server.data_bank.set_holding_registers(addr, [int(value)])
    return True


def set_register(addr, value):
    """Overwrite a single holding register without touching others."""
    server.data_bank.set_holding_registers(addr, [int(value)])

def banner():
    print("=" * 64)
    print(f"  EMS SIMULATOR v8  ({MODBUS_HOST}:{MODBUS_PORT})")
    print("  [R] 0  PV Production              (W)")
    print("  [R] 1  Battery SoC                (%)")
    print("  [W] 2  Inverter Mode               (0=Auto 1=ForceChg 2=ForceDis)")
    print("  [W] 3  Boiler                     (0=Off 1=On)")
    print("      Anti-chatter: min 60 min on/off enforced by simulator")
    print("  [W] 4  Heat Pump Mode             (0=Off 1=Comfort 2=Boost)")
    print("      Anti-chatter: min 60 min on/off enforced by simulator")
    print("  [W] 5  EV Charging Limit          (0-7400W)")
    print("      Anti-chatter: min 60 min on/off enforced by simulator")
    print("  [R] 6  Total House Load           (W)")
    print("  [R] 7  Energy Price                (gr/kWh)")
    print("      Distribution fee added on import (peak 28/off-peak 12 gr/kWh)")
    print("  [R] 8  Peak Price Today            (gr/kWh)")
    print("  [R] 9  Running Cost Today          (grosze)")
    print("  [W] 10 PV Curtailment              (0=Auto 1=Curtail)")
    print("  [R] 11 Charge Window Start          (hour 0-23, 24=none)")
    print("  [R] 12 Charge Window Duration       (hours * 10)")
    print("  [R] 13 PV Forecast Tomorrow         (0.1 kWh)")
    print("  [W] 14 Grid Status                   (0=Normal 1=Blackout 2=Fluktuacje)")
    print("  [W] 15 API Anomaly Simulator          (0=Off 1=On)")
    print("  [W] 16 Storm Safeguard                (0=Off 1=Force 100% SoC)")
    print("  [W] 17 EV Override                    (0=Auto/EMS 1=Manual 7400W)")
    print("  [W] 18 V2G Mode                       (0=Off 1=On — EV discharges to house)")
    print("  [W] 19 Presence Mode                  (0=Home 1=Away 2=Vacation)")
    print("  [W] 20 Notifications Enabled          (0=Off 1=On — master switch)")
    print("  [W] 21 Notify Test Trigger            (write 1 → send test, auto-resets)")
    print("  [W] 22 Notify Category Mute Mask       (bits: 1=grid 2=battery 4=rules 8=security)")
    print("=" * 64)
