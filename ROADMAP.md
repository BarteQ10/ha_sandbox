# Roadmap / Ideas

Possible improvements for the Virtual EMS Inverter Simulator. Grounded in the
current codebase — each item notes the affected files, rough effort
(S = hours, M = a day or two, L = multi-day), and priority.

Priority: 🔴 high (foundation / real gap) · 🟡 medium · 🟢 nice-to-have
Status: ✅ done · ⏳ in progress · — todo

---

## 1. Engineering foundation & quality

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 1.1 | **`requirements.txt`** | repo root | S | 🔴 | ✅ |
| 1.2 | **CI: build + test gate** | `.github/workflows/deploy.yml` | S | 🔴 | ✅ |
| 1.3 | **Backend unit tests** | `tests/` + pytest | M | 🔴 | ✅ |
| 1.4 | **Frontend tests** | vitest + React Testing Library | M | 🟡 | ✅ |
| 1.5 | **Structured logging** | all `ems_simulator/*.py` | M | 🟡 | ✅ |
| 1.6 | **Config validation** | `config.py` | M | 🟡 | ✅ |
| 1.7 | **Type hints + mypy/ruff** | all `*.py`, `.pre-commit-config.yaml` | M | 🟢 | ✅ |
| 1.8 | **Dockerize the simulator** | `Dockerfile`, `docker-compose.yml` | M | 🟡 | ✅ |

---

## 2. Reliability & operations

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 2.1 | **InfluxDB auto-reconnect** | `influx_writer.py` | S | 🔴 | ✅ |
| 2.2 | **HTTP retry + backoff** | `weather.py`, `pricing.py` | S | 🟡 | ✅ |
| 2.3 | **Grafana dashboards** | — | — | — | ❌ removed (not using Grafana) |
| 2.4 | **Health / metrics endpoint** | new `ems_simulator/health.py` | M | 🟢 | ✅ |
| 2.5 | **Graceful shutdown** | `main.py` | S | 🟡 | ✅ |
| 2.6 | **Restore more state on restart** | `main.py`, `influx_writer.py` | M | 🟢 | ✅ |

---

## 3. Simulation realism

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 3.1 | **House thermal model (RC)** | `generators.py`, new `thermal.py` | L | 🟡 | ✅ |
| 3.2 | **Battery State-of-Health (SoH)** | `battery.py` | M | 🟡 | ✅ |
| 3.3 | **Multiple PV strings / orientations** | `generators.py`, `config.py` | M | 🟢 | ✅ |
| 3.4 | **V2G (vehicle-to-grid)** | `generators.py`, `main.py` | L | 🟢 | ✅ |
| 3.5 | **More deferrable appliances** | `config.py`, `generators.py` | M | 🟢 | ✅ |
| 3.6 | **Grid instability behavior** | `main.py` | M | 🟢 | ✅ |
| 3.7 | **Standby power model** — TV/PC <5 W w czuwaniu, realistyczne profile dobowe | `generators.py`, `config.py` | S | 🟡 | ✅ |

---

## 4. Control intelligence & optimization

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 4.1 | **Price & load forecasting** | new `forecasting.py` | M | 🟡 | ✅ |
| 4.2 | **MPC charge optimizer** | new `mpc_scheduler.py` | L | 🟡 | ✅ |
| 4.3 | **Strategy backtesting** | new `backtest.py` | M | 🟡 | ✅ |
| 4.4 | **RL control agent** | new `rl/` | L | 🟢 | ✅ |
| 4.5 | **Anomaly detection on telemetry** | new `anomaly.py` | M | 🟢 | ✅ |

---

## 5. Frontend & UX

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 5.1 | **Loading / offline states** | `components/*`, `App.tsx` | S | 🟡 | ✅ |
| 5.2 | **Settings panel** | new `components/Settings.tsx` | M | 🟡 | ✅ |
| 5.3 | **Alerts / notifications panel** | new `components/Alerts.tsx` | M | 🟡 | ✅ |
| 5.4 | **Animated energy-flow (Sankey)** | `Flow.tsx`, new `EnergyFlow.tsx` | M | 🟢 | ✅ |
| 5.5 | **Daily/weekly reports + CSV export** | new `components/Reports.tsx` | M | 🟡 | ✅ |
| 5.6 | **PWA / mobile layout** | `vite.config.ts`, manifest | M | 🟢 | ✅ |
| 5.7 | **Accessibility pass** | `components/*` | M | 🟢 | ✅ |
| 5.8 | **Render performance (useSyncExternalStore)** | `useHA.tsx` | M | 🟢 | ✅ |
| 5.9 | **Auth hardening** | `haClient.ts`, docs | S | 🟢 | ✅ |
| 5.10 | **Presence tab** — zakładka home/away/vacation z timeline aktywności domowników | new `components/Presence.tsx` | M | 🟢 | ✅ |

---

## 6. Presence & home automation

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 6.1 | **Presence zone simulation** — profil `home/away/vacation` wpływa na profile obciążenia; sensor `sensor.ems_presence_mode` do InfluxDB | `generators.py`, `config.py`, `main.py` | S | 🟡 | ✅ |
| 6.2 | **Circadian lighting model** — jasność i temperatura barwowa zależna od pory dnia; sensory `sensor.ems_light_brightness`, `sensor.ems_light_ct` | new `lighting.py` | M | 🟢 | ✅ |
| 6.3 | **Standby-cut simulation** — urządzenie poniżej progu (TV <5 W, PC <8 W przez 10 min) przełącza się w "smart socket off"; zapis do InfluxDB | `generators.py`, `config.py` | M | 🟡 | ✅ |
| 6.4 | **Vacation mode** — losowe harmonogramy świateł i urządzeń gdy `presence=vacation`; zmiana profilu ładowania | `generators.py`, `main.py` | M | 🟢 | ✅ |
| 6.5 | **Media player state → room scene** — gdy gra: przyciemnij światła; pauza: rozjaśnij; koniec: wyłącz | new `media_sim.py` | M | 🟢 | ✅ |

---

## 7. Notifications & security

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 7.1 | **Actionable alert buttons** — przyciski akcji przy alertach ("Przypomnij za 15 min", "Ignoruj") z lokalną pamięcią decyzji | `frontend/Alerts.tsx` | S | 🟡 | ✅ |
| 7.2 | **Presence-aware alert rules** — "okno otwarte + away", "pranie skończone (drzwi nie otwarto przez 30 min)" | `anomaly.py` lub new `rules.py` | M | 🟡 | ✅ |
| 7.3 | **Telegram/webhook notification bridge** — wysyłanie alertów (anomalie, security events) na zewnątrz; konfiguracja w `config.py` | new `notifications.py` | M | 🟢 | ✅ |
| 7.4 | **Motion event simulation** — losowe eventy ruchu gdy `presence=away`; snapshoty do InfluxDB, opcjonalny webhook | new `security.py` | L | 🟢 | ✅ |

---

## 8. Virtual device ecosystem

Integracja symulatora z wirtualnymi urządzeniami Home Assistant — zamknięcie pętli
między backendem EMS a encjami HA.

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 8.1 | **Presence mode HA control** — `input_select.ems_tryb_obecnosci` + Modbus sync (reg 19) | `configuration.yaml`, `automations.yaml` | S | 🟡 | ✅ |
| 8.2 | **V2G mode HA control** — `input_boolean.ems_v2g_mode` + Modbus sync (reg 18, dotąd brakujący) | `configuration.yaml`, `automations.yaml` | S | 🟡 | ✅ |
| 8.3 | **Circadian lighting templates** — template sensory jasności + CT z krzywej dobowej | `configuration.yaml` | S | 🟢 | ✅ |
| 8.4 | **Adaptive lighting automations** — stosowanie wartości cyrkadianowych do istniejących ściemniaczy (salon, sypialnia, łazienka) | `automations.yaml` | M | 🟢 | ✅ |
| 8.5 | **Smart socket simulation** — `input_boolean` dla TV i mikrofalówki; standby-cut przy Poza domem / Urlop | `configuration.yaml`, `automations.yaml` | S | 🟡 | ✅ |
| 8.6 | **Media player scene** — przyciemnienie lampy salonowej do 25% gdy `sensor.ems_tryb_mediow == playing` | `automations.yaml` | M | 🟢 | ✅ |
| 8.7 | **Health /metrics REST sensor** — HA odczytuje presence, media, motion z endpointu symulatora (co 15s) | `configuration.yaml`, `health.py` | S | 🟡 | ✅ |
| 8.8 | **Tuya virtual device** — wirtualne urządzenie przez Tuya IoT Platform Developer Console + integracja HA | external / `configuration.yaml` | L | 🟢 | — |
| 8.9 | **MQTT device autodiscovery** — symulator publikuje urządzenia przez MQTT (Mosquitto w docker-compose) → HA autodiscovery | new `ems_simulator/mqtt_bridge.py` | M | 🟢 | ✅ |
| 8.10 | **hass-virtual (HACS)** — dedykowane wirtualne encje przez `custom-components/virtual`; alternatywa dla `input_*` | `configuration.yaml` | S | 🟢 | ✅ |

---

## 9. Smart-home expansion & dashboard (delivered)

Rozszerzenia z kolejnych iteracji — wszystko działa i jest pokryte testami.

| # | Item | Where | Status |
|---|------|-------|--------|
| 9.1 | **Aux MQTT devices** — temp/wilgotność, wodomierz/gazomierz, kontaktrony okno/drzwi, czujniki dym/CO/zalanie | `home_devices.py`, `mqtt_bridge.py` | ✅ |
| 9.2 | **Controllable MQTT devices** — brama + garaż (cover), zamek (lock), TRV (climate), odkurzacz (vacuum), nawadnianie (switch), wentylator (fan) | `home_devices.py`, `mqtt_bridge.py`, `main.py` | ✅ |
| 9.3 | **Air-quality sensor** — CO₂/PM2.5/VOC + binary_sensor alert | `home_devices.py` | ✅ |
| 9.4 | **Video doorbell** — `binary_sensor` (occupancy), losowy dzwonek | `home_devices.py` | ✅ |
| 9.5 | **Devices tab** — auto-discovery cover/lock/climate/fan/vacuum + chipy kontaktronów + kafelki środowiskowe | `Devices.tsx`, `DeviceControls.tsx` | ✅ |
| 9.6 | **Editable floor plan** — interaktywny rzut domu; tryb edycji (drag/resize, snap-grid, brak nachodzenia, dodawanie encji), zapis w localStorage | `FloorPlan.tsx`, `lib/floorplan.ts`, `useFloorPlan.ts` | ✅ |
| 9.7 | **Sound alerts + critical banner** — Web Audio, edge-triggered, powtarzanie do potwierdzenia, toggle/critical-only | `useAlarms.tsx`, `lib/sound.ts`, `AlarmBanner.tsx` | ✅ |
| 9.8 | **Per-category Telegram alerts** — maska wyciszenia (reg 22) + 4 przełączniki w UI | `notifications.py`, `main.py`, `Settings.tsx` | ✅ |
| 9.9 | **Notifications UI control** — master toggle + status kanałów + test (reg 20/21) | `Settings.tsx`, `notifications.py` | ✅ |
| 9.10 | **KPI summary + cost forecast** — kafelki na stronie głównej; prognoza kosztu tygodnia (cena+PV) | `DashboardSummary.tsx`, `CostForecast.tsx` | ✅ |
| 9.11 | **MPC vs RL compare + Backtest UI** | `MpcRlCompare.tsx`, `Backtest.tsx`, `/backtest` | ✅ |
| 9.12 | **Persistent event log** — bufor in-memory + InfluxDB (`ems_event`), tryb historii | `events.py`, `influx_writer.py`, `EventLog.tsx` | ✅ |
| 9.13 | **Camera grid + Media control** — auto-discovery `camera.*` / `media_player.*` | `Cameras.tsx`, `Media.tsx` | ✅ |
| 9.14 | **Themed top-level nav** — Dom / Energia / Monitoring / Analiza / Ustawienia; persystencja zakładek; tooltips | `App.tsx`, `usePersistentState.ts` | ✅ |
| 9.15 | **YAML duplicate-key CI guard** — test wykrywający zdublowane klucze w `config/*.yaml` | `tests/test_config_yaml.py` | ✅ |

**Zrobione w tej iteracji:** 9.A własne pokoje + przypisania w planie · 9.B oś czasu urządzenia (HA recorder) · 9.C powiadomienia systemowe przeglądarki · plan: eksport/import + auto-sync przez symulator (`/floorplan`).

### Pomysły na dalej (otwarte)

| # | Item | Effort | Prio |
|---|------|--------|------|
| 9.D | **Widok miesięczny w Raportach** + eksport PDF | M | 🟢 |
| 9.E | **Asystent głosowy / LLM** — sterowanie naturalnym językiem | L | 🟢 |
| 9.F | **Jakość**: mypy, testy `main.py`, E2E Playwright | M | 🟡 |

> ✅ Zrobione: **9.G „Najlepszy czas na…"** — doradca cena RCE + PV (`advisor.py`, `/advisor`, zakładka Energia → Doradca).
