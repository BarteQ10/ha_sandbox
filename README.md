# Virtual EMS Inverter Simulator

Modbus TCP simulator + Home Assistant config for Energy Management System development.

## Quick Start

```bash
pip install pyModbusTCP requests
python run.py
```

HA connects to `192.168.0.18:5020` (Modbus TCP).

## File Structure

```
ems_simulator/
├── config.py         # Location, PV kWp, battery kWh, price bands
├── weather.py        # Open-Meteo API: GHI + temperature + cloud cover
├── pricing.py        # PSE API: real RCE prices (PLN/MWh → gr/kWh)
├── generators.py     # PV, load, spike simulation
├── battery.py        # SoC delta from power balance
├── server.py         # Modbus TCP server (pyModbusTCP)
├── influx_writer.py  # Direct InfluxDB writes (influxdb-client)
└── main.py           # Main loop (entry point)
run.py                # Top-level launcher
```

## Stack

| Component | Technology |
|-----------|-----------|
| Simulator | Python `ems_simulator/` (pyModbusTCP + Open-Meteo + PSE API) |
| Brain | Home Assistant (Docker, port 8123) |
| MQTT | Mosquitto (Docker, port 1883) |
| Telemetry DB | InfluxDB 2.7 (Docker, port 8086) — direct writes |
| ML | `ml_forecast.py` (RandomForest, GHI from Open-Meteo past_days) |
| Dashboard | Lovelace YAML (`ui-lovelace.yaml`) |

### Data flow

```
simulator (Modbus) → InfluxDB (direct, 5s interval)
simulator (Modbus) → HA (Modbus TCP) → automations
                         ↓
                 InfluxDB (for ML / forecasting)
```

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
| 8 | 40009 | R | Peak Price Today | gr/kWh (PSE 24h forecast peak) |
| 9 | 40010 | R | Running Cost Today | grosze (cumulative financial balance) |

## Simulation

- **PV**: 5kWp × **real GHI (shortwave_radiation) from Open-Meteo** — GHI integrates sun angle + cloud cover in a single number, 0 at night, peak ~3850W on sunny noon, dips when clouds pass
- **Cloud cover**: Stored in InfluxDB as `sensor.cloud_cover` (0-100%) for ML feature engineering
- **House**: daily profile + **temperature-dependent load** (heating when <18C, cooling when >26C)
- **Spikes**: random 2-7kW events (kettle, oven, induction) every ~2-8 min
- **Prices**: **real RCE from PSE API** (`api.raporty.pse.pl`) — 15-min aggregated to hourly; shows duck curve (near-zero at solar noon, peak evening)
- **Battery**: 15kWh LiFePO4, smooth SoC delta from real-time power balance

## HA Entities

### Modbus (via MQTT if inverter offline -> show unavailable)
- `sensor.sztuczna_produkcja_pv` — PV power (W)
- `sensor.sztuczny_stan_baterii_soc` — Battery (%)
- `sensor.ems_pobor_domu_bazowy` — House load (W)
- `sensor.ems_biezaca_cena_energii` — Price (gr/kWh)
- `switch.inwerter_wymus_ladowanie_z_sieci` — Force charge
- `switch.ems_bojler_grzalka_3kw` — Boiler Modbus (reg 3)

### REST (Open-Meteo)
- `sensor.open_meteo_ghi` — GHI forecast data (hourly, refreshed every hour)

### Template
- `sensor.ems_moc_netto_bilans` — PV - house load (W)
- `sensor.ems_czas_do_rozladowania` — Estimated minutes until empty
- `sensor.ems_czas_do_pelnego_naladowania` — Estimated minutes until full
- `sensor.ems_prognoza_pv_jutro_szczyt_ghi` — Tomorrow's peak GHI (W/m²) for charging decisions
- `sensor.ems_koszt_kumulatywny_dzis` — Cumulative daily financial balance (grosze, from Modbus reg 9)
- `sensor.ems_bilans_finansowy_dzis` — Same in PLN (template sensor)
- `sensor.ems_szczyt_cena_dzis` — Today's peak price from PSE 24h forecast (gr/kWh, Modbus reg 8)

### Critical: HA → Modbus sync (3 automations)
- `input_boolean.wirtualny_bojler` → `switch.ems_bojler_grzalka_3kw` → reg 3
- `input_select.ems_tryb_pompy_ciepla` → `modbus.write_register` → reg 4 (0/1/2)
- `input_number.ems_limit_ladowania_ev` → `modbus.write_register` → reg 5

Without these sync automations, changing HA entities has no effect on the simulator.

### Riemann integrals (kWh accumulation)
- `sensor.ems_energia_pv_riemann` — PV energy today
- `sensor.ems_energia_netto_riemann` — Net energy today

### Native HA (always available)
- `input_boolean.wirtualny_bojler` — Boiler switch
- `input_select.ems_tryb_pompy_ciepla` — HP mode (Wylaczona/Komfort/Boost)
- `input_number.ems_limit_ladowania_ev` — EV charge limit (0-7400W)
- `input_number.ems_max_pobor_sieci` — Peak shaving threshold
- `input_boolean.ems_peak_shaving_active` — Peak shaving flag
- `input_number.ems_koszt_degradacji_baterii` — Battery degradation cost (gr/kWh, default 15)

## Automations

1. **Smart Boiler** — on when PV > 3000W or price < 0.20 zl/kWh
2. **Peak Shaving** — cuts boiler/HP/EV when grid draw exceeds configurable limit
3. **Smart EV Charging** — matches charge power to PV surplus when battery > 80%
4. **HP Boost** — stores excess PV as heat when battery is full
5. **Bojler Sync** — synchronizes input_boolean → Modbus reg 3
6. **HP Sync** — synchronizes input_select → Modbus reg 4 (0/1/2)
7. **EV Sync** — synchronizes input_number → Modbus reg 5
8. **Night Charging** — charges battery from grid at cheap hours (02:00-05:00, <30 gr/kWh); checks battery degradation cost (spread = PSE peak forecast - current > degradation_cost); skips if tomorrow's GHI peak >400 W/m² (sun will charge for free)
9. **Smart EV (degradation)** — same degradation cost check before grid charging EV at <20 gr/kWh

## Dashboard

3 views defined in `ui-lovelace.yaml`:
- **Przeplywy** — gauges, daily stats, battery runtime, 12h history
- **Sterowanie** — all controllable devices, peak shaving controls, battery degradation cost, prices with peak forecast, GHI forecast, financial balance
- **Energy** — Riemann integrals, 24h price chart, daily financial balance with peak price

## InfluxDB Measurements

Written every 5s by `influx_writer.py` to bucket `ems` (token: `ems-token`, org: `home`):

| Measurement | Description | Unit |
|-------------|-------------|------|
| `sensor.sztuczna_produkcja_pv` | PV power | W |
| `sensor.sztuczny_stan_baterii_soc` | Battery SoC | % |
| `sensor.ems_pobor_domu_bazowy` | House load | W |
| `sensor.ems_biezaca_cena_energii` | Energy price | gr/kWh |
| `sensor.ems_moc_netto_bilans` | Net balance (PV - load) | W |
| `sensor.current_temp` | Outdoor temperature | °C |
| `sensor.cloud_cover` | Cloud cover | % |
| `sensor.shortwave_radiation` | GHI (Global Horizontal Irradiance) | W/m² |
| `sensor.ems_koszt_chwilowy_pln` | Instantaneous financial cost (+spend, -revenue) | PLN/tick |
| `sensor.ems_koszt_kumulatywny_dzis` | Cumulative daily financial balance | PLN |
| `sensor.ems_szczyt_cena_dzis` | Today's peak price (PSE 24h forecast) | gr/kWh |

## Financial Counter & Battery Degradation

### Real-time cost tracking
Every tick (`TICK_S=5s`, 60× speed → 5 simulated min), the simulator computes:
```
dt_h = 5 * 60 / 3600 = 1/12 h       # simulated hours per tick
cost_chwilowy = -balance * price / (100 * 1000 * dt_h)   # PLN
```
- `balance < 0` (grid import) → positive cost (spending)
- `balance > 0` (grid export) → negative cost (revenue)
- Written to InfluxDB as `sensor.ems_koszt_chwilowy_pln`
- Cumulative `running_cost_pln` resets at simulated midnight (`day_step == 0`)
- On restart, restored from InfluxDB last value (via `inf_read_last`)

### Battery degradation cost
`input_number.ems_koszt_degradacji_baterii` (default 15 gr/kWh) represents the real cost of cycling the battery (15kWh ÷ 6000 cycles × 15000 zl ≈ 15 gr/kWh).

Night charging and EV grid charging only fire when:
```
PSE_peak_forecast - current_price > degradation_cost
```

### Peak price from PSE forecast
`pricing.max_today()` returns the maximum price from the cached 24h PSE data (all hours already fetched at once). If PSE API fails, falls back to max price band (80 gr/kWh). Exposed via Modbus reg 8 as `sensor.ems_szczyt_cena_dzis`.

## ML Forecast (`ml_forecast.py`)

Predicts PV production for the next 48h using a RandomForest model:

- **Training features**: GHI + temperature + cloud_cover (from Open-Meteo with `past_days=N`) + hour sin/cos
- **Target**: PV power from InfluxDB (`sensor.sztuczna_produkcja_pv`)
- **Forecast**: weather features from Open-Meteo → predicted PV (GHI=0 → PV=0 automatically)

### Usage

```bash
# Let the simulator run for at least 12h to accumulate training data
python run.py

# In another terminal:
python ml_forecast.py          # last 3 days
python ml_forecast.py 7        # last 7 days
```

Output: `forecast.png` (time series plot) + `forecast_feature_importance.png`

> Historical GHI is fetched from Open-Meteo's `past_days` parameter (same endpoint as forecast), so it covers the full training period even if `sensor.shortwave_radiation` was added to InfluxDB recently.