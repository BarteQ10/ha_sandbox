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
├── config.py              # Location, PV kWp, battery kWh, price bands
├── weather.py             # Open-Meteo API: GHI + temperature + cloud cover
├── pricing.py             # PSE API: real RCE prices (PLN/MWh → gr/kWh)
├── generators.py          # PV, load, spike simulation
├── battery.py             # SoC delta from power balance
├── charge_scheduler.py    # Dynamic charge window (PV forecast + price bands)
├── server.py              # Modbus TCP server (pyModbusTCP)
├── influx_writer.py       # Direct InfluxDB writes (influxdb-client)
└── main.py                # Main loop (entry point)
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
| 2 | 40003 | RW | Inverter Mode | 0=Auto, 1=Force Charge, 2=Force Discharge |
| 3 | 40004 | RW | Boiler (resistive) | 0=Off, 1=On (+3000W) |
| 4 | 40005 | RW | Heat Pump Mode | 0=Off, 1=Comfort (+1500W), 2=Boost (+3000W) |
| 5 | 40006 | RW | EV Charging Limit | 0-7400 W |
| 6 | 40007 | R | Total House Load | W (base + all devices + spikes) |
| 7 | 40008 | R | Energy Price | 15-80 gr/kWh (TGE simulation) |
| 8 | 40009 | R | Peak Price Today | gr/kWh (PSE 24h forecast peak) |
| 9 | 40010 | R | Running Cost Today | grosze (cumulative financial balance) |
| 10 | 40011 | RW | PV Curtailment | 0=Auto, 1=Zero-Export (curtail) |
| 11 | 40012 | R | Charge Window Start | hour (0-23, 24=no charge needed) |
| 12 | 40013 | R | Charge Window Duration | hours × 10 |
| 13 | 40014 | R | PV Forecast Tomorrow | kWh × 10 |
| 14 | 40015 | RW | Grid Status | 0=Normal, 1=Blackout, 2=Fluktuacje |

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
- `switch.ems_bojler_grzalka_3kw` — Boiler Modbus (reg 3)
- `switch.ems_ograniczenie_pv` — PV Curtailment (reg 10)

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

### Critical: HA → Modbus sync (4 automations)
- `input_boolean.wirtualny_bojler` → `switch.ems_bojler_grzalka_3kw` → reg 3
- `input_select.ems_tryb_pompy_ciepla` → `modbus.write_register` → reg 4 (0/1/2)
- `input_number.ems_limit_ladowania_ev` → `modbus.write_register` → reg 5
- `input_select.ems_status_sieci` → `modbus.write_register` → reg 14 (0/1/2)

Without these sync automations, changing HA entities has no effect on the simulator.

### Riemann integrals (kWh accumulation)
- `sensor.ems_energia_pv_riemann` — PV energy today
- `sensor.ems_energia_netto_riemann` — Net energy today

### Native HA (always available)
- `input_boolean.wirtualny_bojler` — Boiler switch
- `input_select.ems_tryb_pompy_ciepla` — HP mode (Wylaczona/Komfort/Boost)
- `input_select.ems_tryb_inwertera` — Inverter mode (Auto/Force Charge/Force Discharge)
- `input_select.ems_status_sieci` — Grid status (Normal/Blackout/Fluktuacje)
- `input_number.ems_limit_ladowania_ev` — EV charge limit (0-7400W)
- `input_number.ems_max_pobor_sieci` — Peak shaving threshold
- `input_boolean.ems_peak_shaving_active` — Peak shaving flag
- `input_number.ems_koszt_degradacji_baterii` — Battery degradation cost (gr/kWh, default 15)

## Automations

1. **Smart Boiler** — on when PV > 3000W or price < 0.20 zl/kWh
2. **Peak Shaving** — cuts boiler/HP/EV when grid draw exceeds configurable limit
3. **Smart EV Charging** — matches charge power to PV surplus when battery > 80%
4. **HP Boost** — stores excess PV as heat when battery is full
5. **Charge Scheduler** (`charge_scheduler.py`) — every simulated hour, computes tomorrow's PV energy from Open-Meteo forecast, calculates energy needed for target SoC, finds cheapest consecutive night hours for charging; exposes window via reg 11-13
6. **Bojler Sync** — synchronizes input_boolean → Modbus reg 3
7. **HP Sync** — synchronizes input_select → Modbus reg 4 (0/1/2)
8. **EV Sync** — synchronizes input_number → Modbus reg 5
9. **Dynamic Night Charging** — uses scheduler's optimal window (cheapest consecutive night hours based on PV forecast + PSE prices + degradation cost)
10. **Smart EV (degradation)** — same degradation cost check before grid charging EV at <20 gr/kWh
11. **Inverter Sync** — synchronizes input_select → Modbus reg 2 (0/1/2)
12. **Arbitrage: Discharge on peak** — when price >55 gr, SoC >20%, switches to Force Discharge
13. **Arbitrage: Charge on low price** — when price <25 gr, SoC <80%, switches to Force Charge (checks degradation)
14. **Arbitrage: Return to Auto** — when 25 ≤ price ≤ 55 or SoC critical, switches back to Auto
15. **Negative prices: Smart load dispatch** — when price < 0: always boiler + Force Charge; if SoC > 30% adds EV 7400W; if SoC > 50% adds HP Boost
16. **Negative prices: PV curtailment** — when price < 0, SoC > 95%, and still exporting → enables zero-export (curtail PV)
17. **Negative prices: Restore normal** — when price returns above 0, disables curtailment, returns inverter to Auto, turns off loads
18. **Grid Status Sync** — synchronizes `input_select.ems_status_sieci` → Modbus reg 14 (0/1/2)
19. **Island load shed** — when Blackout + SoC < 30%, force off boiler/EV/HP in HA
20. **Island recovery** — when grid returns to Normal, restore normal operation

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
| `sensor.ems_ograniczenie_pv` | PV curtailment status (0=Auto, 1=Curtail) | — |
| `sensor.ems_charge_window_start` | Charge window start hour | h |
| `sensor.ems_charge_window_duration` | Charge window duration | h×10 |
| `sensor.ems_pv_forecast_tomorrow_kwh` | Forecast PV energy tomorrow | kWh |
| `sensor.ems_status_sieci` | Grid status (0=Normal, 1=Blackout, 2=Fluktuacje) | — |

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

### Inverter round-trip efficiency
`INVERTER_EFFICIENCY = 0.92` in `config.py` models AC↔DC conversion losses (~8% dissipated as heat). Applied in `battery.py`:
- **Charging** (`balance > 0` or Force Charge): effective SoC delta = `power × 0.92 / SOC_DELTA_DENOM`
- **Discharging** (`balance < 0` or Force Discharge): effective SoC delta = `-power / 0.92 / SOC_DELTA_DENOM`

This adds an additional cost layer on top of battery degradation: arbitrage must cover both the 8% energy loss and the 15 gr/kWh cycle cost before generating profit.

### Battery degradation cost
`input_number.ems_koszt_degradacji_baterii` (default 15 gr/kWh) represents the real cost of cycling the battery (15kWh ÷ 6000 cycles × 15000 zl ≈ 15 gr/kWh).

Night charging and EV grid charging only fire when:
```
PSE_peak_forecast - current_price > degradation_cost
```

## Island Mode (Grid Status — Reg 14)

`input_select.ems_status_sieci` controls simulated grid status via Modbus reg 14:

| Value | Mode | Description |
|-------|------|-------------|
| 0 | Normal | Grid connected — full financial tracking, force charge/discharge available |
| 1 | Blackout | Grid disconnected — island mode |
| 2 | Fluktuacje | Grid instability (reserved for future use) |

### Behavior in Blackout (reg 14 = 1)

- **No grid exchange**: `running_cost_pln` stops accumulating (no financial tracking)
- **Force Charge ignored**: treated as Auto (no grid to draw from)
- **Load shedding**: when SoC ≤ 5% and still deficit (`pv - load < 0`), Python sheds all controllable loads (boiler, EV, HP) and recalculates balance. If still negative, battery drains to 0%.
- **HA protection**: separate automation (`EMS: Island mode - load shed ochrona`) monitors grid_status and SoC every minute — turns off boiler, EV, HP in HA when Blackout + SoC < 30%
- **Recovery**: automation `EMS: Island mode - powrot sieci` fires when grid returns to Normal

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

## Weather Caching

`weather.py` stores forecast data keyed by `(date, hour)` tuple, so `get(hour)` always returns today's data (not overwritten by tomorrow's). Full forecast rows are cached in `_forecast_rows` on `fetch()` — `forecast_df()` returns them without a second HTTP call.