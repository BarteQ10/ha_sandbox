# Virtual EMS Inverter Simulator

Modbus TCP simulator + Home Assistant config for Energy Management System development.

## Quick Start

```bash
pip install -r requirements.txt
python run.py
```

HA connects to `192.168.0.18:5020` (Modbus TCP).

## Docker (full stack)

`docker-compose.yml` brings up the whole backend in one command:

```bash
docker compose up --build
```

| Service | Port | Purpose |
|---------|------|---------|
| `homeassistant` | 8123 | Home Assistant — automations + UI ("the brain") |
| `influxdb` | 8086 | Telemetry DB — the simulator writes here directly |
| `ems-simulator` | 5020 | This project — Modbus TCP server + simulation loop |

The `ems-simulator` service builds from the local `Dockerfile` and reaches InfluxDB over the compose network (`INFLUX_URL=http://influxdb:8086`). Override credentials in the service `environment:` block.

> No MQTT broker is included: the simulator talks to HA over **Modbus TCP** and writes telemetry to **InfluxDB directly** (see the data-flow diagram below).

### Graceful shutdown

The simulator handles **SIGTERM** (sent by `docker stop` / `docker compose down` / systemd) just like Ctrl+C: it flushes the final InfluxDB writes and stops the Modbus server cleanly. `stop_grace_period: 15s` gives it time to finish, so a normal stop loses no telemetry.

## File Structure

```
ems_simulator/
├── config.py              # Location, PV/inverter kW, battery kWh, COP/price/soiling/EV config
├── weather.py             # Open-Meteo API: GHI + temperature + cloud cover
├── pricing.py             # PSE API + distribution_rate() tariff helper
├── generators.py          # PV (clip + soiling), load, spike, DeviceTimer, COP, EVProfile, ScheduledAppliance
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
| Telemetry DB | InfluxDB 2.7 (Docker, port 8086) — direct writes |
| ML | `ml_forecast.py` (RandomForest, GHI from Open-Meteo past_days) |
| Dashboard | React TS (`frontend/`) — optional, connects via HA REST + WebSocket |
| Lovelace | `ui-lovelace.yaml` — legacy HA dashboard |

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
| 15 | 40016 | RW | API Anomaly Simulator | 0=Off, 1=On (forces synthetic data) |
| 16 | 40017 | RW | Storm Safeguard | 0=Off, 1=Force 100% SoC |
| 17 | 40018 | RW | EV Override | 0=Auto/EMS, 1=Manual 7400W |

## Simulation

- **PV**: 5kWp × **real GHI (shortwave_radiation) from Open-Meteo** — GHI integrates sun angle + cloud cover in a single number, 0 at night, peak ~3850W on sunny noon, dips when clouds pass
- **PV clipping**: inverter max 5000W — excess power clipped (inverter rating)
- **PV soiling**: seasonal soiling factor (summer 0.96, winter 0.88 + random snow events that reduce output to 30% for ~2h)
- **Cloud cover**: Stored in InfluxDB as `sensor.cloud_cover` (0-100%) for ML feature engineering
- **House**: daily profile + **temperature-dependent load** (heating when <18C, cooling when >26C)
- **Spikes**: random 2-7kW events (kettle, oven, induction) every ~2-8 min
- **Prices**: **real RCE from PSE API** (`api.raporty.pse.pl`) — 15-min aggregated to hourly; shows duck curve (near-zero at solar noon, peak evening)
- **Distribution fees**: on import (`balance < 0`), distribution cost added to PSE price: peak hours (6-13, 15-22) +28 gr/kWh, off-peak +12 gr/kWh. Export uses PSE price only (no distribution paid by operator).
- **Battery**: 15kWh LiFePO4, smooth SoC delta from real-time power balance
- **Calendar aging**: 2% capacity loss per year — effective capacity decreases over simulated time

## HA Entities

### Modbus
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
- `input_boolean.ems_storm_safeguard` — Storm safeguard toggle (big red button on dashboard)
- `input_boolean.ems_ev_override` — EV manual override (forces 7400W regardless of economics)

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
21. **Anomaly sync** — synchronizes `input_boolean.ems_symuluj_awarie_api` → Modbus reg 15
22. **Storm Safeguard sync** — synchronizes `input_boolean.ems_storm_safeguard` → Modbus reg 16
23. **EV Override sync** — synchronizes `input_boolean.ems_ev_override` → Modbus reg 17

## Dashboard

3 views defined in `ui-lovelace.yaml`:
- **Przeplywy** — gauges, daily stats, battery runtime, 12h history
- **Sterowanie** — all controllable devices, peak shaving controls, battery degradation cost, prices with peak forecast, GHI forecast, financial balance
- **Energy** — Riemann integrals, 24h price chart, daily financial balance with peak price

## CI/CD Deployment

On push to `master`, GitHub Actions deploys to a Linux server / Raspberry Pi via SSH:

1. `git pull` on the server
2. `pip install -r requirements.txt`
3. `npm ci && npm run build` in `frontend/`
4. Restart `ems-simulator` systemd service (if managed)

### Setup

Add these secrets to GitHub repo → Settings → Secrets and variables → Actions:

| Secret | Description |
|--------|-------------|
| `SERVER_HOST` | Server IP or domain |
| `SERVER_USER` | SSH username |
| `SSH_KEY` | Private SSH key (deploy key) |
| `SERVER_PORT` | SSH port (default 22) |
| `PROJECT_PATH` | Absolute path to project on server |

Or deploy manually: `./deploy.sh /path/to/project`

## InfluxDB Measurements

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
| `sensor.ems_storm_safeguard` | Storm safeguard status | — |
| `sensor.ems_ev_override` | EV override status | — |

## Financial Counter & Battery Degradation

### Real-time cost tracking
Every tick (`TICK_S=5s`, 60× speed → 5 simulated min), the simulator computes:
```
dt_h = 5 * 60 / 3600 = 1/12 h       # simulated hours per tick
effective_price = price + distribution_rate(hour)  if importing (balance < 0)
effective_price = price                              if exporting (balance > 0)
cost_chwilowy = -balance * effective_price / (100 * 1000 * dt_h)   # PLN
```
- `balance < 0` (grid import) → positive cost (spending)
- `balance > 0` (grid export) → negative cost (revenue)
- Written to InfluxDB as `sensor.ems_koszt_chwilowy_pln`
- Cumulative `running_cost_pln` resets at simulated midnight (`day_step == 0`)
- On restart, restored from InfluxDB last value (via `inf_read_last`)
- If InfluxDB goes down mid-run, the writer keeps the simulator alive and auto-reconnects every `RECONNECT_COOLDOWN_S` (30s) instead of disabling telemetry permanently

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

## API Anomaly Simulator (Reg 15)

`input_boolean.ems_symuluj_awarie_api` controls simulated API failures via Modbus reg 15:

| Value | Mode | Description |
|-------|------|-------------|
| 0 | Off | Normal operation — fetches real PSE prices and Open-Meteo weather |
| 1 | On | API failure — skips all HTTP calls, forces synthetic fallback data |

### Edge cases handled

1. **Charge scheduler during anomaly**: `compute_charge_window()` is skipped entirely (does not call `forecast_df()`). When the anomaly is disabled, `_last_chg_compute_h` is reset → the scheduler fires on the next tick.
2. **Re-sync after API returns**: `needs_refresh()` detects the hour change → immediate fetch once the anomaly is disabled. The scheduler resumes with fresh data.

### Behavior when active (reg 15 = 1)

- **PSE pricing**: `p_get()` is never called; `fallback_price()` returns synthetic bands (15-80 gr/kWh)
- **Open-Meteo weather**: `ghi` forced to `None` → `pv_from_ghi()` uses synthetic PV (sin wave + random cloud)
- **Temperature**: holds last measured value (no update until anomaly deactivated)
- **Failover test**: verifies the system seamlessly transitions to synthetic data (already implemented in `pv_from_ghi` and `p_fallback`) without error loops

Use together with persistent notifications in HA to observe the transition and recovery.

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

## Distribution Fees (Tariff)

On every tick, when importing from grid (`balance < 0`), the financial calculation adds a distribution tariff on top of the PSE price:

```
effective_price = pse_price + distribution_rate(hour)
```

| Zone | Hours | Rate |
|------|-------|------|
| Off-peak | 0-6, 13-15, 22-24 | +12 gr/kWh |
| Peak | 6-13, 15-22 | +28 gr/kWh |

Export (`balance > 0`) uses PSE price only — the grid operator does not pay you for distribution.

This makes arbitrage more realistic: charging from grid during daytime peak can be unprofitable even with a low PSE price, because the 28 gr/kWh distribution fee eats the margin.

## HP COP (Coefficient of Performance)

`hp_cop(temp)` in `generators.py` interpolates a COP curve from config:

| Temperature | COP |
|-------------|-----|
| -15°C | 1.5 |
| -5°C | 2.5 |
| +5°C | 3.5 |
| +15°C | 4.5 |
| +25°C | 5.0 (clamped) |

When HP is active and outdoor temp < 18°C, the thermal output (`HP_power × COP`) covers part of the heating base load. The electrical base load is reduced by 80% of the overlap — the HP provides heat more efficiently than resistive heating.

## EV Profile

`EVProfile` in `generators.py` models a real EV owner pattern:

- **Arrival**: 17:00 (car plugged in at home)
- **Departure**: 7:00 (car leaves)
- **Daily need**: 15 kWh (configurable via `EV_DAILY_KWH_NEEDED`)
- **Auto-charge**: when plugged in and >1 kWh still needed, EV set to 3700W base charge

Energy delivered is tracked per simulated day and resets at midnight. The profile interacts with the EV Override (reg 17) — when override is active, the profile ignores plugged state and delivers full 7400W.

## Scheduled Appliances

`ScheduledAppliance` in `generators.py` models deferrable loads with a time window:

| Appliance | Power | Duration | Window |
|-----------|-------|----------|--------|
| Washer | 2000W | 1.5h | 8:00-22:00 |
| Dishwasher | 1500W | 1.0h | 22:00-6:00 |

Each appliance has a state machine: `idle → running → done`. When the time window opens, the appliance starts automatically and runs for the configured duration. After finishing, it stays `done` for the rest of the simulated day.

## Self-Consumption Priority

When grid-connected (`GRID_NORMAL`) and SoC drops below 20% with a power deficit (`balance < 0`), the system sheds non-essential loads by priority:

1. **EV** (first to shed — lowest priority)
2. **HP** (shed only if EV already off)
3. **Boiler** (shed only if HP already off)
4. **Base load** (never shed — essential)

This prevents deep battery discharge and reduces expensive grid import during high-price periods.

## Calendar Aging

In addition to the per-cycle degradation cost (15 gr/kWh), the battery loses 2% of its capacity per simulated year (`CALENDAR_AGING_PCT_PER_YEAR` in `config.py`).

The `aging_factor` is applied to `SOC_DELTA_DENOM` in `battery.delta()`:
- After 1 simulated year: effective capacity = 98%
- After 5 years: effective capacity = 90%
- After 15 years: clamped at 70% (end of life)

This interacts with cycle degradation: as the battery holds less energy, arbitrage revenues decrease because the same SoC swing moves fewer kWh.

## Anti-Chattering (Device Minimum On/Off Times)

Controllable devices (boiler, heat pump, EV) cannot toggle more frequently than once per `DEVICE_MIN_ON_SIM_MIN` / `DEVICE_MIN_OFF_SIM_MIN` simulated minutes (default 60 min, configurable in `config.py`).

A `DeviceTimer` state machine in `generators.py` tracks each device:

```
constrain(desired):
  was_on → want_off  && timer > 0  → return current value (stay on)
  was_off → want_on  && timer > 0  → return 0 (stay off)
  timer expired or same state      → accept desired value, reset timer
```

- Timer bypassed in island mode emergency (SoC ≤ 5%) — new empty timer created after forced shed
- The effective (constrained) value is written back to Modbus, so HA sees the actual device state
- `[TIMER]` log messages show when constraints are active

## Storm Safeguard (Reg 16)

`input_boolean.ems_storm_safeguard` controls emergency storm protection via Modbus reg 16:

| Value | Mode | Description |
|-------|------|-------------|
| 0 | Off | Normal operation |
| 1 | Active | Force battery to 100% SoC, block discharge |

### Behavior when active (reg 16 = 1)

- **Force charge from grid**: `actual_force` is overridden to `MODE_FORCE_CHARGE` on every tick, regardless of the inverter mode set in HA (reg 2 is left untouched — user's setting preserved)
- **Discharge blocked**: even if HA requests Force Discharge, the internal override keeps charging
- **Dashboard**: big red button (`mdi:weather-lightning`) on Sterowanie view
- **Deactivation**: when toggled off, the override stops and the system returns to the inverter mode stored in HA (no automatic change to Auto — respects user preference)

## EV Override (Reg 17)

`input_boolean.ems_ev_override` forces EV charging to max power via Modbus reg 17:

| Value | Mode | Description |
|-------|------|-------------|
| 0 | Auto/EMS | EV controlled by scheduler, price logic, PV surplus |
| 1 | Manual Max | EV forced to 7400W regardless of economics |

### Behavior when active (reg 17 = 1)

- **Bypasses all logic**: ignores price limits, PV surplus thresholds, degradation checks, and anti-chattering timer
- **Full 7400W draw**: pulls from grid and/or battery as needed, testing peak shaving algorithms
- **Use case**: simulate a family member who needs to leave urgently and charges at max power regardless of electricity price

## Weather Caching

`weather.py` stores forecast data keyed by `(date, hour)` tuple, so `get(hour)` always returns today's data (not overwritten by tomorrow's). Full forecast rows are cached in `_forecast_rows` on `fetch()` — `forecast_df()` returns them without a second HTTP call.

## React Frontend (`frontend/`)

Optional standalone dashboard replacing or complementing the HA Lovelace UI.

### Quick Start

```bash
cd frontend
cp .env.example .env
# Edit .env — set VITE_HA_TOKEN from http://localhost:8123/profile
npm install
npm run dev
```

Open `http://localhost:5173`.

### Stack

| Component | Technology |
|-----------|-----------|
| Framework | React 19 + TypeScript + Vite |
| UI | shadcn/ui (Radix primitives + Tailwind CSS v4) |
| Charts | recharts |
| Icons | lucide-react |
| i18n | react-i18next + i18next-browser-languagedetector |
| HA API | `home-assistant-js-websocket` (WebSocket for live state + service calls) |

### Architecture

```
React ←→ HA WebSocket (live state_changed events + service calls)
React → HA REST API (initial state fetch + history for charts)
HA → Modbus TCP → Python Simulator
```

### Features

- **Smart Home dashboard**: room cards (Salon, Kuchnia, Sypialnia, Lazienka, Ogrod) with temperature, humidity, blinds, and multi-light controls per room
- **Multi-light control**: individual light toggles with dimmer (1-100%) and color temperature (2700-6500K) or RGB (R/G/B 0-255) sliders, plus All-ON/OFF per room
- **Thermostat setpoint**: +/- buttons in Salon, Kuchnia, Sypialnia for target temperature (16-30°C, step 0.5)
- **Room sub-views**: Wspolne / Prywatne / Ogrod tabs
- **System view**: energy flow gauges, inverter/boiler/HP controls, daily stats, price history, charge window, PV forecast
- **History charts**: 12h PV/battery history, 24h price chart with proper time-scaled X-axis
- **Glassmorphism UI**: semi-transparent cards with backdrop blur, gradient backgrounds
- **Dark/light theme**: toggle with system preference detection, persisted to localStorage
- **i18n**: Polish/English, persisted to localStorage, toggle in header

### Structure

```
frontend/src/
├── api/haClient.ts          # HA connection (WS + REST history)
├── hooks/
│   ├── useHA.tsx            # HA context + entity hooks
│   └── useTheme.tsx         # Dark/light theme toggle
├── components/
│   ├── Rooms.tsx            # Room cards (lights, dimmer, color temp, blinds, temp)
│   ├── Flow.tsx             # Energy flow view
│   ├── Controls.tsx         # Device controls
│   ├── Energy.tsx           # Energy & finance
│   ├── charts/
│   │   ├── FlowGauge.tsx    # SVG ring gauge
│   │   └── MiniChart.tsx    # Line chart with HA history
│   └── ui/                  # shadcn/ui components
├── locales/
│   ├── pl.json              # Polish translations
│   └── en.json              # English translations
├── lib/utils.ts             # cn() utility
├── App.tsx                  # Root with tabs, theme, lang switcher
└── i18n.ts                  # i18next configuration
```