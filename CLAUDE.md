# CLAUDE.md

Guidance for AI agents (Claude Code et al.) working in this repository.

## What this project is

A **Virtual EMS (Energy Management System) Inverter Simulator** for Home Assistant
development. A Python simulation loop exposes a Modbus TCP server, writes telemetry
to InfluxDB, publishes MQTT autodiscovery entities, and serves a health/metrics HTTP
endpoint. Home Assistant runs the control automations; a React dashboard provides the UI.

See `README.md` for the full architecture and `ROADMAP.md` for feature status
(sections 1-8, essentially all complete).

## Golden rules

- **Never commit, push, or open PRs unless explicitly asked** (see `AGENTS.md`).
  Wait for "commit" / "zrób commit". Never `git push` without an explicit request.
- **Code and comments in English.** Polish is kept only for HA entity IDs / option
  strings (e.g. `input_select.ems_tryb_obecnosci`, `"W domu"`) — these must match HA.
- **Match existing style** — no new frameworks or patterns without reason.

## Repository layout

```
ems_simulator/   # Python simulation package (~19 modules — see README File Structure)
rl/              # Optional Q-learning agent (EMS_RL_ENABLED=1)
tests/           # pytest backend tests
frontend/        # React 19 + TS + Vite dashboard (vitest tests in src/__tests__/)
config/          # Home Assistant config (configuration.yaml, automations.yaml)
mosquitto/       # MQTT broker config (data/ and log/ are gitignored)
backtest.py      # 4-strategy historical comparison
ml_forecast.py   # Standalone PV forecast + plots
run.py           # Top-level launcher
```

The simulation entry point is `ems_simulator/main.py` (`main()`), the single big
loop that ties every subsystem together. New per-tick behaviour usually plugs in there.

## Key architectural facts

- **Modbus registers**: 23 total (`NUM_REGISTERS` in `config.py`). R = simulator
  writes, RW = HA writes. Reg map in `server.py` banner + README. Latest additions:
  18 = V2G, 19 = Presence, 20 = Notifications enabled, 21 = Notify test trigger,
  22 = Notify category mute mask.
- **Auxiliary MQTT virtual devices** (`home_devices.py`): a separate class of
  "props" (sensors, contacts, air-quality, doorbell, gate/garage, lock, TRV,
  vacuum, irrigation, fan) published via MQTT autodiscovery (`mqtt_bridge.py`),
  **not** through Modbus. Controllable ones route commands to a `command_fn`
  callback in `main.py`, not to a register. Add new ones here, not as registers.
- **HA ↔ Modbus sync**: changing an HA `input_*` entity does nothing until an
  automation in `automations.yaml` writes the value to the matching register.
  When you add a control entity, add its sync automation too.
- **Timing**: `TICK_S=5` real seconds = 5 simulated minutes (60× speed).
  `STEPS_PER_HOUR=12`, `STEPS_PER_DAY=288`.
- **Telemetry**: every subsystem writes to InfluxDB via `influx_writer.py`
  (`sensor.ems_*` measurements). The React app reads via HA, not InfluxDB directly.
- **Config is the single source of truth** — constants live in `config.py` and are
  validated at startup by `config_validator.py`. Update both when adding config.

## Adding a new simulated subsystem (the common task)

1. New module in `ems_simulator/` with a small class exposing a `tick()` method.
2. Add config constants to `config.py` (+ validation if invariants matter).
3. Add `write_*()` to `influx_writer.py` for telemetry.
4. Wire it into `main.py`: instantiate before the loop, call `tick()` inside,
   write telemetry, push to `health.update()` and (if user-facing) `mqtt_bridge`.
5. If HA-controllable: add a Modbus register (bump `NUM_REGISTERS`, update
   `server.py` banner), an `input_*` entity + sync automation in `config/`.
6. Write tests in `tests/test_<module>.py`.

## Running things

```bash
# Backend
pip install -r requirements-dev.txt
python run.py                 # run the simulator
pytest -q                     # all backend tests
ruff check ems_simulator/ rl/ tests/   # lint (must be clean — CI gates it)
mypy ems_simulator/ rl/ tests/         # type-check (must be clean — CI gates it)

# Frontend
cd frontend
npm install
npm run dev                   # dev server on :5173
npm run test                  # vitest (CI gates it)
npx tsc --noEmit              # type-check

# Full stack
docker compose up --build     # HA + InfluxDB + Mosquitto + simulator
```

## CI gate (`.github/workflows/deploy.yml`)

On push to `master`: ruff → mypy → pytest → tsc → vitest → frontend build → SSH deploy.
**Keep ruff + mypy clean and all tests green** — a red gate blocks deploy.

## Gotchas

- **Ruff config** is in `pyproject.toml` (line-length 100, py311). Import ordering
  (I001) is enforced — run `ruff check --fix` before committing Python.
- **monkeypatch the bound name**: module-level constants imported with
  `from config import X` must be patched on the *consuming* module
  (e.g. `monkeypatch.setattr(generators, "STANDBY_CUT_AFTER_TICKS", 1)`),
  not on `config`.
- **jsdom needs stubs**: `ResizeObserver` and `matchMedia` are stubbed in
  `frontend/src/__tests__/setup.ts` for Radix UI components. Add stubs there.
- **Optional deps degrade gracefully**: `paho-mqtt` (MQTT) and the RL agent are
  guarded — the simulator runs without them. Keep new optional integrations
  behind an `enabled()` check or env-var flag.
- **Line endings**: repo is developed on Windows; git warns about LF→CRLF. Harmless.
