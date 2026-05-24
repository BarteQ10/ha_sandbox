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

def write(registers):
    server.data_bank.set_holding_registers(0, registers)

def banner():
    print("=" * 64)
    print(f"  EMS SIMULATOR v5  ({MODBUS_HOST}:{MODBUS_PORT})")
    print("  [R] 0  PV Production              (W)")
    print("  [R] 1  Battery SoC                (%)")
    print("  [W] 2  Inverter Mode               (0=Auto 1=ForceChg 2=ForceDis)")
    print("  [W] 3  Boiler                     (0=Off 1=On)")
    print("  [W] 4  Heat Pump Mode             (0=Off 1=Comfort 2=Boost)")
    print("  [W] 5  EV Charging Limit          (0-7400W)")
    print("  [R] 6  Total House Load           (W)")
    print("  [R] 7  Energy Price               (gr/kWh)")
    print("  [R] 8  Peak Price Today           (gr/kWh)")
    print("  [R] 9  Running Cost Today          (grosze)")
    print("  [W] 10 PV Curtailment              (0=Auto 1=Curtail)")
    print("  [R] 11 Charge Window Start          (hour 0-23, 24=none)")
    print("  [R] 12 Charge Window Duration       (hours * 10)")
    print("  [R] 13 PV Forecast Tomorrow         (0.1 kWh)")
    print("=" * 64)
