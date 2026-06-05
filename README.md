# Virtual EMS Inverter Simulator

Modbus TCP simulator + Home Assistant config for Energy Management System development.

> Planning to move to real hardware? See **[MIGRATION.md](MIGRATION.md)** for how
> the control intelligence transfers ~1:1 and what HA takes on.

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
| `mosquitto` | 1883 / 9001 | MQTT broker (TCP + WebSocket) for device autodiscovery |
| `ems-simulator` | 5020 / 8088 | This project — Modbus TCP server + health/metrics HTTP |

The `ems-simulator` service builds from the local `Dockerfile` and reaches InfluxDB over the compose network (`INFLUX_URL=http://influxdb:8086`). Override credentials in the service `environment:` block.

> The simulator talks to HA over **three channels**: Modbus TCP (registers),
> direct InfluxDB writes (telemetry), and MQTT autodiscovery (live entities). See
> the data-flow diagram below.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `INFLUX_URL` | `http://influxdb:8086` | InfluxDB endpoint |
| `INFLUX_TOKEN` / `INFLUX_ORG` / `INFLUX_BUCKET` | `ems-token` / `home` / `ems` | InfluxDB auth |
| `LOG_LEVEL` | `INFO` | Logging verbosity |
| `MQTT_HOST` | `mosquitto` | MQTT broker host (empty = disable bridge) |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_USER` / `MQTT_PASS` | *(empty)* | MQTT auth (optional) |
| `HEALTH_PORT` | `8088` | Health/metrics HTTP port |
| `EMS_RL_ENABLED` | `0` | `1` enables the Q-learning control agent (`rl/`) |
| `EMS_WEBHOOK_URL` | *(empty)* | Generic webhook for alerts (POST JSON) |
| `EMS_TELEGRAM_TOKEN` / `EMS_TELEGRAM_CHAT_ID` | *(empty)* | Telegram bot notifications |
| `EMS_LLM_URL` | *(empty)* | Local LLM endpoint for the NL assistant, incl. `/v1` (e.g. `http://localhost:1234/v1` for LM Studio, `http://localhost:11434/v1` for Ollama). Empty = assistant uses the offline rule parser only. |
| `EMS_LLM_MODEL` | `bielik-11b-v3.0-instruct` | Model id served by the local LLM |

### Graceful shutdown

The simulator handles **SIGTERM** (sent by `docker stop` / `docker compose down` / systemd) just like Ctrl+C: it flushes the final InfluxDB writes and stops the Modbus server cleanly. `stop_grace_period: 15s` gives it time to finish, so a normal stop loses no telemetry.

## Multi-device & remote access (nginx + Tailscale)

To use the dashboard on a computer, a wall tablet and a phone — **including over
cellular, off the home Wi-Fi** — serve it behind the bundled nginx reverse proxy
and expose it privately with Tailscale. One origin, real HTTPS, no open ports.

Why HTTPS matters: the **voice assistant mic, browser notifications and PWA
install only work in a secure context** (HTTPS) on anything other than
`localhost`. Tailscale provides a valid cert, so these work on every device.

```
phone / tablet / PC  (home Wi-Fi or cellular)
   └─ HTTPS (tailscale serve cert)
        └─ Tailscale → nginx :8080 ─┬─ /      → React build (frontend/dist, PWA)
                                    ├─ /ha/   → Home Assistant (REST + WebSocket)
                                    └─ /sim/  → simulator :8088 (/assistant, /advisor…)
```

The proxy build is **same-origin**: HA under `/ha`, the simulator under `/sim`,
with the origin resolved at runtime — so one build works on localhost, a LAN IP,
or a Tailscale hostname without rebuilding (`frontend/src/api/base.ts`).

**Setup**

```bash
# 1. Build the frontend in proxy mode (put VITE_HA_TOKEN in frontend/.env first)
cd frontend && npm run build:proxy && cd ..

# 2. Bring up the stack — now includes the nginx service on :8080
docker compose up -d --build

# 3. Expose it privately with Tailscale (install on the server + each device)
tailscale up
tailscale serve --bg 8080          # HTTPS on https://<host>.<tailnet>.ts.net
tailscale serve status             # shows the URL

# 4. On phone/tablet: install Tailscale, log into the same tailnet, open that
#    https URL, then "Add to Home Screen" for a full-screen PWA.
```

To reach a host-side local LLM (LM Studio/Ollama) from the simulator container,
set `EMS_LLM_URL=http://host.docker.internal:1234/v1` (the compose file already
maps `host.docker.internal`).

> If Home Assistant logs proxy warnings, add to `configuration.yaml`:
> `http: { use_x_forwarded_for: true, trusted_proxies: [172.16.0.0/12] }`.

## File Structure

```
ems_simulator/
├── config.py              # Location, PV/inverter kW, battery kWh, COP/price/soiling/EV/presence config
├── config_validator.py    # Startup validation of config invariants
├── log_setup.py           # Structured logging setup
├── weather.py             # Open-Meteo API: GHI + temperature + cloud cover
├── pricing.py             # PSE API + distribution_rate() tariff helper
├── http_util.py           # HTTP retry + backoff helper
├── generators.py          # PV (clip + soiling), load, spike, DeviceTimer, COP, EVProfile, ScheduledAppliance, StandbyDevice
├── battery.py             # SoC delta from power balance + State-of-Health (SoH)
├── thermal.py             # RC house thermal model (temperature dynamics)
├── charge_scheduler.py    # Dynamic charge window (PV forecast + price bands)
├── forecasting.py         # RandomForest PV/load/price 24h forecasting
├── mpc_scheduler.py       # Model-Predictive-Control battery optimizer
├── anomaly.py             # Z-score anomaly detection on telemetry
├── presence.py            # Presence zones: home/away/vacation load profiles
├── lighting.py            # Circadian lighting model (brightness + colour temp)
├── media_sim.py           # Simulated media player (dims lights when playing)
├── rules.py               # Presence-aware rule engine (window_away, laundry_done)
├── security.py            # Motion event simulation (indoor/outdoor PIR)
├── home_devices.py        # Aux smart devices: sensors (temp/humidity/air-quality/meters), contacts, doorbell, gate/garage, lock, TRV, vacuum, irrigation, fan
├── notifications.py       # Webhook + Telegram alert bridge (edge-triggered)
├── mqtt_bridge.py         # MQTT autodiscovery → HA entities
├── health.py              # Health / metrics HTTP endpoint (port 8088)
├── server.py              # Modbus TCP server (pyModbusTCP)
├── influx_writer.py       # Direct InfluxDB writes (influxdb-client)
└── main.py                # Main loop (entry point)
rl/
├── state.py               # State encoding + reward shaping
└── agent.py               # Tabular Q-learning agent (EMS_RL_ENABLED=1)
backtest.py            # 4-strategy historical comparison (baseline/auto/scheduled/MPC)
ml_forecast.py        # Standalone RandomForest PV forecast + plots
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
simulator → InfluxDB        (direct writes, 5s interval — telemetry + ML training)
simulator → HA (Modbus TCP) → automations → Modbus writes back (control loop)
simulator → MQTT (Mosquitto) → HA autodiscovery (live entities, ~10s push)
simulator → HTTP :8088      (health / metrics — HA REST sensor polls /metrics)
simulator → webhook/Telegram (edge-triggered alerts: blackout, motion, rules)
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
| 18 | 40019 | RW | V2G Mode | 0=Off, 1=On (EV discharges to house) |
| 19 | 40020 | RW | Presence Mode | 0=Home, 1=Away, 2=Vacation |
| 20 | 40021 | RW | Notifications Enabled | 0=Off, 1=On (master switch) |
| 21 | 40022 | RW | Notify Test Trigger | write 1 → send test, auto-resets to 0 |
| 22 | 40023 | RW | Notify Category Mute Mask | bits: 1=grid, 2=battery, 4=rules, 8=security (set bit = muted) |

`NUM_REGISTERS = 23` in `config.py`.

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
- `input_boolean.ems_v2g_mode` — V2G toggle (EV discharges to house, reg 18)
- `input_select.ems_tryb_obecnosci` — Presence mode (W domu/Poza domem/Urlop, reg 19)
- `input_boolean.wirtualne_gniazdo_tv` / `wirtualne_gniazdo_mikrofalowka` — smart sockets

### From /metrics REST sensor (presence subsystem)
- `sensor.ems_metrics_snapshot` — polls simulator `:8088/metrics` every 15 s
- `sensor.ems_jasnosc_cyrkadianowa` / `sensor.ems_temperatura_barwowa_cyrkadianowa` — circadian lighting (template)
- `sensor.ems_tryb_mediow` — media player state (idle/playing/paused)
- `binary_sensor.ems_czujnik_ruchu_zewnetrzny` / `_wewnetrzny` — outdoor/indoor motion

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
24. **V2G sync** — synchronizes `input_boolean.ems_v2g_mode` → Modbus reg 18
25. **Presence sync** — synchronizes `input_select.ems_tryb_obecnosci` → Modbus reg 19 (0/1/2)
26. **Adaptive lighting** — every 5 min applies circadian brightness + colour temp to salon/sypialnia/lazienka dimmers (only when home)
27. **Smart socket standby-cut** — cuts TV/microwave sockets when presence is Away/Vacation, restores on return
28. **Media player scene** — dims salon lamp to 25% when `sensor.ems_tryb_mediow == playing`, restores circadian on idle
29. **Indoor motion alert** — HA notification when indoor motion is detected while away
30. **Notifications enable sync** — synchronizes `input_boolean.ems_notifications_enabled` → Modbus reg 20
31. **Notify test button** — `input_button.ems_notify_test` → Modbus reg 21 = 1 (simulator sends test + auto-resets)

## Dashboard (legacy Lovelace)

> The primary UI is the **React frontend** (see below). `ui-lovelace.yaml` is the
> older HA-native dashboard, kept for reference.

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

> **Security note:** `VITE_HA_TOKEN` is a long-lived HA token bundled into the
> client-side JavaScript at build time. Anyone who can load the app can read it.
> Keep the app behind your home network / VPN. Use a dedicated HA user with only
> the permissions this dashboard needs (entities + services, no admin).

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
- **Top-level navigation**: themed sections — **Dom** · **Energia** · **Monitoring** · **Analiza** · **Ustawienia** — each with its own sub-tabs (icon-only on mobile, icon+label on ≥ sm):
  - **Dom** (Home): **Plan** (editable interactive floor plan — rooms glow when lit + show temperature, tap to toggle lights; device markers live + clickable. **Edit mode**: drag rooms/markers, resize rooms (snap-grid, no hard overlap lock), add/rename/remove rooms, bind lights + a temperature sensor to a room (⚙), add any placeable HA entity, remove markers. Layout syncs to the simulator (`/floorplan`, cross-browser) with localStorage as offline cache; export/import JSON + reset) + Wspolne / Prywatne / Ogrod room views + **Media** + **Urzadzenia**, with the KPI summary + cost-forecast sidebar
  - **Energia**: Flow · Charts · **Doradca** ("best time to run" — cheapest/greenest start hour for washer/dishwasher/EV from the RCE price + PV forecast, via the simulator's `/advisor` endpoint; per-appliance cost + saving vs now + a 24h price/PV chart) · Controls · Presence
  - **Monitoring**: Cameras · Events · **History** (per-entity timeline — numeric entities as an area chart, discrete ones as a coloured state strip; picker + 6h/24h/7d range, from HA recorder) · Alerts
  - **Analiza**: Reports · Backtest · Weather
  - **Ustawienia**: thresholds, notifications, sound alerts + **system notifications** (browser Notifications API — fire on critical alarms even when the tab is backgrounded; opt-in with permission), system config, tariff zones
  - **Flow**: animated SVG energy-flow diagram + gauges + 12h history
  - **Controls**: inverter/HP/grid selects, boiler/PV/anomaly switches, **presence mode + V2G + smart socket**, storm/EV override, EV limit + degradation sliders
  - **Energy**: Riemann integrals, 24h price chart, daily financial balance
  - **Alerts**: actionable alert cards with snooze (15 min) / dismiss (1 h) buttons
  - **Events**: chronological event log from the simulator's `/events` endpoint — anomalies, rules, security (motion), energy (standby cuts), media, grid — with category filter, severity colour, relative time, live auto-refresh, and a date-range history mode (queries persisted events from InfluxDB)
  - **Cameras**: auto-discovered grid of all `camera.*` entities; each tile has a snapshot/stream toggle (snapshot polling ⇄ MJPEG live) and a fullscreen button. The garden room card also embeds its camera with a MOTION badge

  The **Home** tab (rooms) has a **Media** sub-tab alongside the rooms:
  - **Media**: auto-discovered `media_player.*` entities (Spotify, Cast, Sonos, Music Assistant…) with now-playing (title/artist/album + album art), transport controls (play/pause/next/prev), volume slider + mute, and a progress bar. Controls are shown per the player's `supported_features`. Falls back to the simulator's media state when no real player exists
  - **Weather**: GHI + temperature forecast, PV forecast tomorrow
  - **Reports**: daily/weekly summary with CSV export
  - **Backtest**: on-demand 4-strategy comparison (baseline / auto / scheduled / MPC) over stored history via the simulator's `/backtest` endpoint — best strategy, savings vs baseline, per-strategy table, cumulative-cost chart
  - **Presence**: mode control, motion sensors, media player state, circadian lighting, standby load, rule alerts
  - **Settings**: EMS thresholds, **notifications (enable toggle + channel status + test button)**, system config, tariff zones
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
│   ├── EnergyFlow.tsx       # Animated SVG energy-flow diagram
│   ├── Controls.tsx         # Device controls (incl. presence/V2G/smart socket)
│   ├── Energy.tsx           # Energy & finance
│   ├── Alerts.tsx           # Actionable alerts (snooze/dismiss)
│   ├── Weather.tsx          # Weather + PV forecast
│   ├── Reports.tsx          # Daily/weekly reports + CSV export
│   ├── Presence.tsx         # Presence, motion, media, circadian lighting
│   ├── Settings.tsx         # EMS thresholds + system config
│   ├── StatCard.tsx         # Reusable stat card
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

---

## Forecasting & MPC (`forecasting.py`, `mpc_scheduler.py`)

The simulator forecasts the next 24h and uses Model-Predictive-Control to schedule the battery.

- **`ForecastEngine`** — three RandomForest sub-models (PV, load, price) trained from InfluxDB history + Open-Meteo weather. Re-fits at startup and daily midnight. Falls back to deterministic estimates when history is sparse (`MIN_TRAIN_ROWS=24`).
- **`mpc_scheduler.solve()`** — greedy local search over the 24h price/load forecast. Discharges at p75+ price hours, charges at p25- price hours, up to 3 refinement passes. Returns a per-hour schedule + cost/savings estimate + the action for the current hour.
- **Application**: in `main.py`, when the user has set inverter mode to **Auto**, the MPC recommendation overrides it. A manual Force Charge/Discharge always wins.
- Metrics written to InfluxDB: `sensor.ems_mpc_action`, `sensor.ems_mpc_savings`, `sensor.ems_forecast_*`.

## RL Control Agent (`rl/`)

Optional tabular Q-learning agent. Enable with `EMS_RL_ENABLED=1`.

- **State**: `(soc_bin, hour_bin, price_bin, pv_bin)` = 10×24×5×4 = 4 800 states
- **Actions**: 0=Auto, 1=Force Charge, 2=Force Discharge
- **Algorithm**: online ε-greedy Q-learning (ε decays 0.80 → 0.05 over ~24 real hours)
- **Reward**: negative tick cost, with penalties for low SoC and blackout-with-empty-battery
- **Persistence**: Q-table saved to `rl/qtable.npy` daily and on shutdown, reloaded on startup
- **Priority**: when enabled, the RL action overrides Auto *before* MPC.

## House Thermal Model (`thermal.py`)

RC (resistance-capacitance) model of indoor temperature:

```
dT = (Q_in - UA × (T_house - T_out)) × dt / C   per tick
```

- `C = 8 kWh/°C` thermal mass, `UA = 80 W/°C` heat-loss coefficient, setpoint 20°C ± 0.5°C deadband
- The heat pump's thermal output (`HP_power × COP`) heats the house; losses scale with the indoor-outdoor gap
- Written to InfluxDB as `sensor.ems_t_house`

## Anomaly Detection (`anomaly.py`)

Rolling Z-score detector over 72-tick windows (6 simulated hours). Flags `pv_underperform`, `load_spike`, `price_spike`, `soc_drain` when a value deviates > 3σ. Written to InfluxDB as `sensor.ems_anom_*` every 6 ticks.

## Presence, Lighting & Standby (`presence.py`, `lighting.py`, `generators.py`)

- **Presence zones** (reg 19): `home` (load ×1.0), `away` (×0.35), `vacation` (×0.15). The base-load multiplier models reduced occupancy.
- **Circadian lighting**: brightness 0→100→0 and colour temp 2700→6500→2700 K over the day. Away forces lights off; vacation simulates random evening presence. A small additive load (~40 W max) feeds the simulation. Sensors: `sensor.ems_light_brightness`, `sensor.ems_light_color_temp_k`.
- **Standby devices**: TV/PC/Router/NAS/Microwave with standby + occasional active power. **Smart-socket cut**: eligible low-standby devices (TV ≤7 W, microwave ≤3 W) are cut to 0 W when away, auto-restoring after 6 simulated hours. Aggregate written as `sensor.ems_standby_load_w`.

## Rules, Notifications & Security (`rules.py`, `notifications.py`, `security.py`)

- **Rule engine**: `window_away` (window open while nobody home) and `laundry_done` (washer finished, clothes not removed). Active flags written as `sensor.ems_rule_*`.
- **Motion simulation**: outdoor PIR (always active) + indoor PIR (only when away). Written as `sensor.ems_motion_outdoor/indoor`.
- **Notification bridge**: edge-triggered (fires only on False→True transition) webhook + Telegram for blackout, critical SoC, window-away, and indoor-motion events. Channel secrets (URL, token, chat ID) are configured via `EMS_WEBHOOK_URL` / `EMS_TELEGRAM_*` env vars; disabled if unset.
  - **UI control** (Settings tab): a master enable/disable switch (Modbus reg 20 → `set_enabled()`), live channel-configured status (from `/metrics`), and a **Send test** button (Modbus reg 21, momentary — sends to every configured channel even when notifications are off). Secrets stay in env vars and are never exposed to the UI.
  - **Per-category mute** (Settings tab): four switches (grid, battery, rules, security) let you silence individual alert classes. They pack into a Modbus mute mask (reg 22 → `set_muted()`, inverted bits so 0 = all on); each alert is tagged with a category at its `send_if_changed()` call site.

## MQTT Autodiscovery (`mqtt_bridge.py`)

Publishes the simulator as a single HA device via the MQTT discovery protocol (requires `paho-mqtt` + a running broker — Mosquitto is in `docker-compose.yml`).

- **Entities**: 19 sensors, 9 binary sensors, 2 switches (V2G, irrigation), 1 select (presence), 2 covers (gate, garage), 1 lock, 1 climate, 1 fan, 1 vacuum
- **Auxiliary devices** (`home_devices.py`): temperature/humidity, water + gas meters (`total_increasing`), air-quality (CO₂/PM2.5/VOC) + alert, window/door contacts, leak/smoke/CO safety sensors, video doorbell, plus controllable **gate** + **garage door** (covers), **entrance lock** (lock), **living-room TRV** (climate), **robot vacuum** (vacuum: start/stop/pause/return + battery), **garden irrigation** (switch, auto morning run, skips rain) and a **living-room fan** (fan: on/off + speed %). These are MQTT-only virtual devices — they don't touch the EMS core or Modbus.
- **Control loop**: writable EMS entities (switch/select) write back to Modbus; auxiliary device commands (gate/lock/climate) route to a `command_fn` callback into `HomeDevices`.
- **State push**: every ~10 s from the main loop
- **Setup in HA**: Settings → Devices & Services → Add Integration → MQTT, host `mosquitto`, port `1883`, no auth (broker uses `allow_anonymous`)
- Graceful fallback: bridge disables itself if `paho-mqtt` is missing or `MQTT_HOST` is empty

## Health / Metrics Endpoint (`health.py`)

Lightweight HTTP server on port 8088 (daemon thread):

- `GET /health` → `{"status": "ok"|"degraded", "uptime_s", "ticks", "influx_ok", ...}` (503 if no update in 30 s)
- `GET /metrics` → full simulation snapshot: PV, SoC, load, price, t_house, SoH, presence, media, motion, standby, MPC/RL action, forecast summary
- `GET /backtest?days=N` → runs `backtest.py` over the last N days of InfluxDB history and returns the 4-strategy comparison as JSON (used by the Backtest tab). Served on a threading HTTP server with CORS so the React app can call it cross-origin.
- `GET /events?limit=N&category=X&since=ts` → recent events from the in-memory buffer; `GET /events?from=ISO&to=ISO` queries persisted history from InfluxDB (measurement `ems_event`). Events are recorded by `events.py`, persisted via a registered sink, and the buffer is hydrated from InfluxDB on startup so the log survives restarts. Used by the Events tab (live feed + date-range history).
- `GET /test-alarm?type=smoke|co|leak` → manually latches a `home_devices` safety sensor ON for ~8 ticks so the dashboard's sound-alert + banner flow can be demonstrated on demand (e.g. `curl localhost:8088/test-alarm?type=smoke`).
- `GET /advisor` → "best time to run" advisor: a 24h hourly forecast (RCE price + PV) plus the cheapest start hour for each deferrable appliance (washer/dishwasher/EV), computed by `advisor.py` (PV in an hour offsets the grid import). Pushed from `main()` each sim hour.
- `POST /assistant` → natural-language assistant layer 2: body `{"text": "..."}`, returns a validated `{intent, value, enabled}`. Proxies a locally-hosted LLM (LM Studio / Ollama, OpenAI-compatible) via `assistant_llm.py` with a JSON-schema-constrained intent allow-list. The dashboard only calls this when its offline rule parser (`lib/assistant.ts`) can't match the phrase. `enabled` is false (and intent `unknown`) when `EMS_LLM_URL` is unset — no LLM required.
- `GET/POST /floorplan` → loads/saves the dashboard's floor-plan layout (JSON) so it follows the user across browsers/devices. Persisted to `FLOORPLAN_PATH` (default `/data/floorplan.json`, mounted via `./simulator_data` in docker-compose). The frontend hydrates from here on load and writes through on every edit (localStorage stays as an offline cache).

HA polls `/metrics` via a REST sensor (`sensor.ems_metrics_snapshot`, 15 s interval) to expose presence/media/motion as native HA sensors.

## Tests

```bash
pytest                       # backend (Python)
mypy ems_simulator/ rl/ tests/  # backend type-check
cd frontend && npx vitest run  # frontend unit (TypeScript)
cd frontend && npm run test:e2e  # frontend E2E (Playwright, mock HA)
```

- **Backend**: `tests/` — battery, generators (incl. StandbyDevice), pricing, http_util, presence, lighting, rules, security, media_sim, loop_logic, advisor
- **Frontend (unit)**: `frontend/src/__tests__/` — haClient, useTheme, useCommittedSlider, utils, Presence, Controls
- **Frontend (E2E)**: `frontend/e2e/` — Playwright smoke + navigation against an in-browser HA mock (`VITE_HA_MOCK=1`, `src/api/haMock.ts`); needs no real Home Assistant