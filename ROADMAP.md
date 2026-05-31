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
| 1.7 | **Type hints + mypy/ruff** | all `*.py`, `.pre-commit-config.yaml` | M | 🟢 | — |
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
| 3.3 | **Multiple PV strings / orientations** | `generators.py`, `config.py` | M | 🟢 | — |
| 3.4 | **V2G (vehicle-to-grid)** | `generators.py`, `main.py` | L | 🟢 | — |
| 3.5 | **More deferrable appliances** | `config.py`, `generators.py` | M | 🟢 | ✅ |
| 3.6 | **Grid instability behavior** | `main.py` | M | 🟢 | ✅ |

---

## 4. Control intelligence & optimization

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 4.1 | **Price & load forecasting** | `ml_forecast.py` | M | 🟡 | ✅ |
| 4.2 | **MPC charge optimizer** | `charge_scheduler.py` | L | 🟡 | ✅ |
| 4.3 | **Strategy backtesting** | new `backtest.py` | M | 🟡 | ✅ |
| 4.4 | **RL control agent** | new `rl/` | L | 🟢 | — |
| 4.5 | **Anomaly detection on telemetry** | new module | M | 🟢 | — |

---

## 5. Frontend & UX

| # | Item | Where | Effort | Prio | Status |
|---|------|-------|--------|------|--------|
| 5.1 | **Loading / offline states** | `components/*`, `App.tsx` | S | 🟡 | ✅ |
| 5.2 | **Settings panel** | new `components/Settings.tsx` | M | 🟡 | ✅ |
| 5.3 | **Alerts / notifications panel** | new `components/Alerts.tsx` | M | 🟡 | ✅ |
| 5.4 | **Animated energy-flow (Sankey)** | `Flow.tsx` | M | 🟢 | — |
| 5.5 | **Daily/weekly reports + CSV export** | new `components/Reports.tsx` | M | 🟡 | ✅ |
| 5.6 | **PWA / mobile layout** | `vite.config.ts`, manifest | M | 🟢 | ✅ |
| 5.7 | **Accessibility pass** | `components/*` | M | 🟢 | — |
| 5.8 | **Render performance (useSyncExternalStore)** | `useHA.tsx` | M | 🟢 | ✅ |
| 5.9 | **Auth hardening** | `haClient.ts`, docs | S | 🟢 | ✅ |
