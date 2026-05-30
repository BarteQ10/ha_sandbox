# Roadmap / Ideas

Possible improvements for the Virtual EMS Inverter Simulator. Grounded in the
current codebase — each item notes the affected files, rough effort
(S = hours, M = a day or two, L = multi-day), and priority.

Priority: 🔴 high (foundation / real gap) · 🟡 medium · 🟢 nice-to-have

---

## 1. Engineering foundation & quality

The project has no automated tests, no dependency manifest, and uses `print()`
for everything. These are the highest-leverage gaps.

| # | Item | Why | Where | Effort | Prio |
|---|------|-----|-------|--------|------|
| 1.1 | **Add `requirements.txt` / `pyproject.toml`** | `deploy.sh` and `.github/workflows/deploy.yml` both run `pip install -r requirements.txt`, but the file does not exist — so every deploy fails at that step. A fresh clone also has no pinned deps (README just says `pip install pyModbusTCP requests`, missing `influxdb-client`, `scikit-learn`, `python-dotenv`, …). | repo root | S | 🔴 |
| 1.2 | **CI: build + test before deploy** | `deploy.yml` only SSHes and deploys on push to `master` — no build or test gate. Add a job that runs backend tests + `npm run build` + `tsc`/lint and blocks deploy on failure. | `.github/workflows/deploy.yml` | S | 🔴 |
| 1.3 | **Backend unit tests** | Pure functions like `battery.delta()`, `hp_cop()`, `distribution_rate()`, `DeviceTimer.constrain()`, `pricing.max_today()` are trivially testable and encode real business rules. | `tests/` + `pytest` | M | 🔴 |
| 1.4 | **Frontend tests** | No coverage on `useCommittedSlider`, `kelvinToRgb`, entity hooks, MiniChart parsing. | `vitest` + React Testing Library | M | 🟡 |
| 1.5 | **Structured logging** | Replace `print()` with the `logging` module (levels, timestamps, module names). Enables log filtering and file output in production. | all `ems_simulator/*.py` | M | 🟡 |
| 1.6 | **Config validation** | `config.py` is plain constants; a typo gives a silent wrong simulation. Validate ranges/types (e.g. `pydantic-settings`) and load from env consistently. | `config.py` | M | 🟡 |
| 1.7 | **Type hints + mypy/ruff** | Add hints across the simulator and wire `ruff` + `mypy` into a pre-commit hook. | all `*.py`, `.pre-commit-config.yaml` | M | 🟢 |
| 1.8 | **Dockerize the simulator** | HA/Mosquitto/Influx run in Docker; the simulator runs bare on the host. A `Dockerfile` + compose service makes the whole stack one `docker compose up`. | `Dockerfile`, `docker-compose.yml` | M | 🟡 |

---

## 2. Reliability & operations

| # | Item | Why | Where | Effort | Prio |
|---|------|-----|-------|--------|------|
| 2.1 | **InfluxDB auto-reconnect** | Once a write fails, `_failed = True` is set and the writer gives up **permanently** — a transient DB blip silently kills all telemetry until restart. Add periodic reconnect / backoff. | `influx_writer.py` | S | 🔴 |
| 2.2 | **HTTP retry + backoff** | `weather.fetch()` / `pricing.fetch()` catch-all on any error and fall back to synthetic data with no retry. Add bounded retries (e.g. `tenacity`) before giving up. | `weather.py`, `pricing.py` | S | 🟡 |
| 2.3 | **Grafana dashboards** | `influxdb/` + `grafana/` are already gitignored as runtime dirs, but there's no provisioned dashboard. Ship JSON dashboards (PV, SoC, price, cost) as code. | `grafana/provisioning/` | M | 🟡 |
| 2.4 | **Health / metrics endpoint** | Expose a small HTTP `/health` + Prometheus metrics (tick rate, last fetch age, write failures) for monitoring on the Pi. | new `ems_simulator/health.py` | M | 🟢 |
| 2.5 | **Graceful shutdown** | Only `KeyboardInterrupt` is handled; SIGTERM (systemd stop / Docker) won't flush Influx or close cleanly. Handle signals. | `main.py` | S | 🟡 |
| 2.6 | **Restore more state on restart** | Only `running_cost_pln` is restored from Influx. SoC, EV energy delivered today, appliance state reset every restart. Persist/restore them. | `main.py`, `influx_writer.py` | M | 🟢 |

---

## 3. Simulation realism

| # | Item | Why | Where | Effort | Prio |
|---|------|-----|-------|--------|------|
| 3.1 | **House thermal model** | Heating/cooling load is a static function of outdoor temp. A simple RC thermal mass model (indoor temp as state, HP/heating as input) makes thermostat control and HP COP interaction meaningful. | `generators.py`, new `thermal.py` | L | 🟡 |
| 3.2 | **Battery State-of-Health (SoH)** | Currently only calendar aging. Add cycle-count-based capacity fade + internal resistance growth so degradation cost becomes data-driven, not a fixed 15 gr/kWh. | `battery.py` | M | 🟡 |
| 3.3 | **Multiple PV strings / orientations** | One 5 kWp array. Model E/W split or shading for a more realistic generation curve and self-consumption profile. | `generators.py`, `config.py` | M | 🟢 |
| 3.4 | **V2G (vehicle-to-grid)** | EV is load-only. Let the EV discharge to the house/grid during peaks — a rich arbitrage and peak-shaving scenario. | `generators.py`, `main.py`, new reg | L | 🟢 |
| 3.5 | **More deferrable appliances + user scheduling** | Only Washer/Dishwasher, fixed windows. Add dryer, water heater, and let HA `input_datetime` drive windows. | `config.py`, `generators.py` | M | 🟢 |
| 3.6 | **Grid "Fluktuacje" (instability) behavior** | `GRID_INSTABILITY = 2` is defined and documented as "reserved for future use" but does nothing. Implement voltage/frequency wobble effects. | `main.py` | M | 🟢 |

---

## 4. Control intelligence & optimization

| # | Item | Why | Where | Effort | Prio |
|---|------|-----|-------|--------|------|
| 4.1 | **Price & load forecasting** | ML predicts PV only. Add RCE price and house-load forecasting (same feature pipeline) to feed smarter scheduling. | `ml_forecast.py` | M | 🟡 |
| 4.2 | **MPC charge optimizer** | The charge scheduler is a greedy "cheapest consecutive hours" heuristic. A model-predictive / linear-program optimizer over the 24-48h horizon (PV + price + load forecast, battery + degradation constraints) would noticeably improve cost. | `charge_scheduler.py` | L | 🟡 |
| 4.3 | **Strategy backtesting harness** | Replay historical Influx/Open-Meteo/PSE data through the control logic to compare strategies offline (€ saved, cycles used) without waiting for live ticks. | new `backtest.py` | M | 🟡 |
| 4.4 | **RL control agent (experimental)** | The simulator is effectively a Gym-like environment. Wrap it and train an RL agent on the cost signal — a strong portfolio/demo piece. | new `rl/` | L | 🟢 |
| 4.5 | **Anomaly detection on telemetry** | Flag sensor drift / impossible values (e.g. PV at night, SoC jumps) from the Influx stream. | `ml_forecast.py` / new module | M | 🟢 |

---

## 5. Frontend & UX

| # | Item | Why | Where | Effort | Prio |
|---|------|-----|-------|--------|------|
| 5.1 | **Loading / error / empty states** | Most components render `0` or blank until WS connects; MiniChart only shows "No data". Add skeletons and a clear "disconnected" overlay. | `components/*`, `useHA.tsx` | S | 🟡 |
| 5.2 | **Settings panel** | Thresholds (peak-shaving limit, degradation cost, price bands) require editing `config.py`/YAML. A settings view writing to HA `input_number`s would make tuning live. | new `components/Settings.tsx` | M | 🟡 |
| 5.3 | **Alerts / notifications panel** | Surface events the simulator already logs (blackout, snow, price < 0, battery empty, clipping) as in-app toasts / a notifications feed. | new `components/Alerts.tsx` | M | 🟡 |
| 5.4 | **Animated energy-flow (Sankey)** | The Flow view shows gauges; an animated PV→house/battery/grid Sankey is a much clearer mental model. | `Flow.tsx` | M | 🟢 |
| 5.5 | **Daily/weekly/monthly reports + CSV/PDF export** | Aggregate cost, self-consumption %, cycles, savings. Export for analysis. | new `components/Reports.tsx`, `haClient.ts` | M | 🟡 |
| 5.6 | **PWA / mobile layout** | Make it installable and usable on a phone (it's a home dashboard). | `vite.config.ts`, manifest | M | 🟢 |
| 5.7 | **Accessibility pass** | Color-only state indicators, icon-only buttons lack labels, contrast on glass cards. Add ARIA labels + check contrast. | `components/*` | M | 🟢 |
| 5.8 | **Render performance** | `useHA` does `setEntities({...e})` on every `state_changed`, re-rendering the whole tree each tick. Move to `useSyncExternalStore` with per-entity selectors. | `useHA.tsx` | M | 🟢 |
| 5.9 | **Auth hardening** | Long-lived token sits in `VITE_HA_TOKEN` (bundled into the client). Document the risk; consider a small proxy for production. | `haClient.ts`, docs | S | 🟢 |

---

## 6. Quick wins (do these first)

Small, high-value, low-risk — good warm-up tasks:

1. **`requirements.txt`** (1.1) — the deploy currently fails on `pip install -r requirements.txt`.
2. **CI build/test gate** (1.2) — stop broken builds reaching the server.
3. **InfluxDB auto-reconnect** (2.1) — fixes a real silent data-loss bug.
4. **HTTP retry/backoff** (2.2) — fewer needless fallbacks to synthetic data.
5. **Loading/disconnected states** (5.1) — immediate UX polish.

## Suggested first milestone

A "make it solid" sprint: **1.1 + 1.2 + 1.3 + 2.1 + 2.2**. That gives a
reproducible build, honest CI, a test safety net, and a telemetry pipeline that
survives transient failures — the base everything else builds on.
