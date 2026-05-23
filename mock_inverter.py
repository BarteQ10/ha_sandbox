import time
import random
import math
from pyModbusTCP.server import ModbusServer

NUM_REGISTERS = 8

server = ModbusServer("0.0.0.0", port=5020, no_block=True)
server.start()

print("================================================================")
print("  VIRTUAL INVERTER EMS v4 (ENHANCED)")
print("  Address: localhost:5020")
print("  [R] 0 (40001): PV Production (W)")
print("  [R] 1 (40002): Battery SoC (%)")
print("  [W] 2 (40003): Force Charge (0=Auto, 1=Force)")
print("  [W] 3 (40004): Boiler Status (0=Off, 1=On -> +3000W)")
print("  [W] 4 (40005): Heat Pump Mode (0=Off, 1=Comfort, 2=Boost -> +2000W)")
print("  [W] 5 (40006): EV Charging Limit (0-7400W)")
print("  [R] 6 (40007): Total House Background Load (W)")
print("  [R] 7 (40008): Current Energy Price (gr/kWh)")
print("================================================================")

server.data_bank.set_holding_registers(0, [0, 100, 0, 0, 0, 0, 0, 0])

day_step = 0
cloud_cover = 0.3

def generate_pv_power(hour, clouds):
    if hour < 5 or hour > 20:
        return 0
    angle = math.pi * (hour - 5) / 15
    max_power = 5000
    base = max_power * max(0, math.sin(angle))
    factor = 1.0 - clouds * random.uniform(0.3, 0.9)
    base *= factor
    base += random.gauss(0, 100)
    return max(0, int(base))

def generate_energy_price(hour):
    if 2 <= hour < 5:
        return random.randint(15, 25)
    elif 5 <= hour < 8:
        return random.randint(25, 40)
    elif 8 <= hour < 13:
        return random.randint(35, 55)
    elif 13 <= hour < 16:
        return random.randint(20, 35)
    elif 16 <= hour < 22:
        return random.randint(50, 80)
    else:
        return random.randint(20, 35)

def generate_base_load(hour):
    if 0 <= hour < 6:
        return random.randint(150, 350)
    elif 6 <= hour < 9:
        return random.randint(500, 900)
    elif 9 <= hour < 14:
        return random.randint(300, 600)
    elif 14 <= hour < 18:
        return random.randint(400, 700)
    elif 18 <= hour < 23:
        return random.randint(600, 1100)
    else:
        return random.randint(300, 500)

spike_remaining = 0
spike_power = 0
spike_duration = 0

try:
    while True:
        words = server.data_bank.get_holding_registers(0, NUM_REGISTERS)
        if not words:
            time.sleep(5)
            continue

        current_soc = words[1]
        force_charge = words[2]
        boiler_status = words[3]
        hp_status = words[4]
        ev_limit = words[5]

        day_step = (day_step + 1) % 288
        hour = day_step / 12

        if day_step % 6 == 0:
            if 6 <= hour <= 18:
                cloud_cover = max(0.0, min(1.0, cloud_cover + random.uniform(-0.2, 0.2)))
            else:
                cloud_cover = 0.0

        new_pv = generate_pv_power(hour, cloud_cover)

        house_load = generate_base_load(hour)

        if boiler_status == 1:
            house_load += 3000

        if hp_status == 1:
            house_load += 1500
        elif hp_status == 2:
            house_load += 3000

        if ev_limit > 0:
            house_load += min(ev_limit, 7400)

        if spike_remaining > 0:
            spike_remaining -= 1
            if spike_remaining <= 0:
                spike_power = 0
                print(f"[SPIKE] Load spike ended")
            else:
                house_load += spike_power
        else:
            if random.random() < 0.03:
                spike_power = random.choice([2000, 2500, 3000, 5000, 7000])
                spike_duration = random.randint(1, 4)
                spike_remaining = spike_duration
                house_load += spike_power
                print(f"[SPIKE] New spike: +{spike_power}W for {spike_duration * 5}s")

        price = generate_energy_price(hour)

        balance = new_pv - house_load

        delta_soc = balance / 1080.0

        if force_charge == 1:
            delta_soc = 5000 / 1080.0

        new_soc = max(0, min(100, current_soc + delta_soc))

        if force_charge == 1:
            print(f"[FORCE] Grid charging. SoC: {current_soc:.1f} -> {new_soc:.1f}%")
        elif balance > 200 and new_soc > current_soc:
            print(f"[PV] Surplus: +{balance}W. SoC: {current_soc:.1f} -> {new_soc:.1f}%")
        elif balance > 0 and new_soc >= 100:
            print(f"[GRID] Battery full! Surplus {balance}W exported to grid")
        elif balance < -200 and new_soc < current_soc:
            print(f"[BAT] Deficit: {balance}W. SoC: {current_soc:.1f} -> {new_soc:.1f}%")
        elif new_soc <= 0:
            print(f"[GRID] Battery empty! Grid draw: {-balance}W, price: {price}gr/kWh")

        server.data_bank.set_holding_registers(0, [
            int(new_pv),
            int(round(new_soc)),
            force_charge,
            boiler_status,
            hp_status,
            ev_limit,
            int(house_load),
            price
        ])

        time.sleep(5)

except KeyboardInterrupt:
    server.stop()