# Virtual EMS Inverter Simulator

Modbus TCP simulator + Home Assistant config for Energy Management System development.

## Quick Start

```bash
pip install pyModbusTCP
python mock_inverter.py
```

HA connects to `192.168.0.18:5020` (Modbus TCP).

## Stack

| Component | Technology |
|-----------|-----------|
| Simulator | Python + pyModbusTCP |
| Brain | Home Assistant (Docker, port 8123) |
| MQTT | Mosquitto (Docker, port 1883) |
| Dashboard | Lovelace YAML (`ui-lovelace.yaml`) |

## Modbus Registers

| Reg | Address | R/W | Description | Range |
|-----|---------|-----|-------------|-------|
| 0 | 40001 | R | PV Production | 0-5000 W |
| 1 | 40002 | R | Battery SoC | 0-100 % |
| 2 | 40003 | RW | Force Charge | 0=Auto, 1=Grid Charge |
| 3 | 40004 | RW | Boiler (resistive) | 0=Off, 1=On (+3000W) |
| 4 | 40005 | RW | Heat Pump Mode | 0=Off, 1=Comfort (+1500W), 2=Boost (+3000W) |
| 5 | 40006 | RW | EV Charging Limit | 0-7400 W |
| 6 | 40007 | R | Total House Load | W (base + all devices + spikes) |
| 7 | 40008 | R | Energy Price | 15-80 gr/kWh (TGE simulation) |

## Simulation

- **PV**: sinusoidal 5kWp curve, dynamic cloud cover changes every ~30 min
- **House**: daily profile (night ~250W, evening ~850W) + controllable loads
- **Spikes**: random 2-7kW events (kettle, oven, induction) every ~2-8 min
- **Prices**: TGE-style (cheapest 2-5 at 15gr, peak 16-22 at 80gr)
- **Battery**: 15kWh LiFePO4, smooth SoC delta from real-time power balance

## HA Entities

### Modbus (via MQTT if inverter offline -> show unavailable)
- `sensor.sztuczna_produkcja_pv` — PV power (W)
- `sensor.sztuczny_stan_baterii_soc` — Battery (%)
- `sensor.ems_pobor_domu_bazowy` — House load (W)
- `sensor.ems_biezaca_cena_energii` — Price (gr/kWh)
- `switch.inwerter_wymus_ladowanie_z_sieci` — Force charge
- `switch.ems_pompa_ciepla_boost` — HP boost toggle

### Template
- `sensor.ems_moc_netto_bilans` — PV - house load (W)
- `sensor.ems_czas_do_rozladowania` — Estimated minutes until empty
- `sensor.ems_czas_do_pelnego_naladowania` — Estimated minutes until full

### Riemann integrals (kWh accumulation)
- `sensor.ems_energia_pv_riemann` — PV energy today
- `sensor.ems_energia_netto_riemann` — Net energy today

### Native HA (always available)
- `input_boolean.wirtualny_bojler` — Boiler switch
- `input_select.ems_tryb_pompy_ciepla` — HP mode (Wylaczona/Komfort/Boost)
- `input_number.ems_limit_ladowania_ev` — EV charge limit (0-7400W)
- `input_number.ems_max_pobor_sieci` — Peak shaving threshold
- `input_boolean.ems_peak_shaving_active` — Peak shaving flag

## Automations

1. **Smart Boiler** — on when PV > 3000W or price < 0.20 zl/kWh
2. **Peak Shaving** — cuts HP/EV when grid draw exceeds configurable limit
3. **Smart EV Charging** — matches charge power to PV surplus when battery > 80%
4. **HP Boost** — stores excess PV as heat when battery is full

## Dashboard

3 views defined in `ui-lovelace.yaml`:
- **Przeplywy** — gauges, daily stats, battery runtime, 12h history
- **Sterowanie** — all controllable devices, peak shaving controls, prices
- **Energy** — Riemann integrals, 24h price chart