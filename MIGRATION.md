# Migration Plan — Simulator → Physical Hardware

How to move this project from the virtual EMS simulator to a real PV inverter +
battery, while reusing as much of the existing code as possible. Written as a
forward-looking reference — nothing here is implemented yet.

> **TL;DR**: The control intelligence (forecasting, MPC, RL, pricing, weather,
> telemetry, dashboard, HA automations) is hardware-agnostic and transfers almost
> 1:1. Only the *simulation* layer (fake PV/load/battery/thermal) is replaced by
> real hardware — which is exactly its purpose. The hard part is hardware quirks
> and safety, not code.

---

## 1. The body / brain split

The simulator already separates **fake hardware** from **EMS intelligence**:

```
BODY (replaced by real hardware)     BRAIN (kept as-is)
────────────────────────────────     ──────────────────
generators.py  (fake PV/load)        forecasting.py     (RandomForest)
battery.py     (fake SoC delta)      mpc_scheduler.py
thermal.py     (fake house temp)     charge_scheduler.py
server.py      (PRETENDS to be       rl/                (Q-learning)
                an inverter)         anomaly.py, backtest.py
EVProfile, spikes, soiling           pricing.py, weather.py (already real)
```

## 2. Code reuse breakdown

| Module(s) | Fate | Reuse |
|-----------|------|-------|
| `forecasting.py`, `mpc_scheduler.py`, `charge_scheduler.py`, `rl/`, `backtest.py` | Run identically on real data | ~95% |
| `pricing.py` (PSE), `weather.py` (Open-Meteo) | Already fetch real data | 100% |
| `influx_writer.py`, `health.py`, `mqtt_bridge.py`, `notifications.py`, `log_setup.py`, `http_util.py`, `config_validator.py` | Hardware-independent infra | 100% |
| `server.py` | **Invert**: Modbus *server* (fakes inverter) → Modbus *client* (reads real inverter). Protocol knowledge transfers, direction flips | ~40% |
| `main.py` | Loop stays; data source swaps (`pv_from_ghi()` → read real register) | ~60% |
| `generators.py`, `battery.py`, `thermal.py`, EV profile | This *is* what real hardware replaces | ~0% (the goal, not a loss) |
| React frontend (`frontend/`) | Reads HA entities — fully hardware-agnostic | 100% |
| HA automations (`config/automations.yaml`) | Operate on HA entities, not the simulator — control policy transfers | ~90% (needs tuning) |

**Net: ~60–70% of the Python (all the valuable layers) transfers nearly unchanged.**

## 3. What Home Assistant takes on

HA has **native integrations** for most real inverters, which replace what
`server.py` currently fakes:

- **SunSpec Modbus** (Fronius, SMA, SolarEdge), **Huawei Solar**, **Victron
  (Cerbo/Venus)**, **GoodWe**, **Sungrow**, **Deye/Solarman**, etc.

After migration:

- **HA** owns: device communication (native integration) + control-policy
  execution (your existing automations) + the dashboard.
- **Your Python** owns: the intelligence HA lacks — ML forecasting, MPC, RL,
  backtesting — running as a sidecar (as today), reading **real** data from
  InfluxDB / HA instead of generating it.

The key architectural win: control logic lives in **HA automations on entities**,
not inside the simulator. Swapping the engine underneath does not break the brain
on top.

## 4. The hard parts (honest)

Difficulty is in **hardware + safety**, not code:

1. **Per-vendor register maps** — every inverter differs. Some forbid external
   battery control entirely, or only allow it via the vendor cloud.
2. **Warranty / safety** — some vendors **void warranty** on control-register
   writes. Grid codes, anti-islanding, over-discharge protection all apply.
3. **Calibration** — COP curves, the 15 gr/kWh degradation cost, thermal params
   are currently *guesses*. Real hardware needs measured values.
4. **Cost of error** — a drained battery in sim is a log line; on real hardware
   it's money or cell damage.
5. **I/O reliability** — real Modbus has timeouts, dropped connections, write
   throttling. (`http_util.py`'s retry/backoff pattern is reusable here.)

> ⚠️ **The RL agent (`EMS_RL_ENABLED=1`) must never control real hardware while
> learning.** Its ε-greedy exploration takes random actions. On real hardware,
> run it in shadow/recommendation mode only.

## 5. Migration path (incremental, lowest-risk first)

### Phase 0 — Shadow mode (zero risk)
- Connect the real inverter to HA **read-only** (native integration).
- Keep the simulator's Modbus server **off**; point the brain at the real entities.
- `forecasting.py` / `mpc_scheduler.py` / `rl/` only **recommend** and log to
  InfluxDB. No writes to hardware.
- Compare predictions vs reality. Validate the data pipeline end-to-end.

**Files touched**: HA config (add real integration), `main.py` (read real
register values instead of `pv_from_ghi()` etc. — behind a `MODE=shadow` flag),
`server.py` (add a Modbus *client* mode alongside the existing server).

### Phase 1 — Calibration
- After weeks of real data: retrain the RF models on actual PV/load/price.
- Measure real COP, tune degradation cost, fit thermal params to real temps.
- Run `backtest.py` on real history to validate each strategy economically.

### Phase 2 — Human-in-the-loop control
- MPC proposes; an HA automation executes only **safe** actions (e.g. charge in a
  cheap window) with **hard SoC limits** and a manual override.
- Start with the least risky control: scheduled charging, not real-time arbitrage.

### Phase 3 — Full autonomy
- Only once the data and economics are trusted. RL stays advisory unless proven.

## 6. Concrete first steps when you start

1. Identify the inverter model → find its HA integration + whether it allows
   battery-control writes.
2. Add a `MODE` config flag: `sim` (today) | `shadow` | `live`.
3. Add a Modbus **client** path to `server.py` (or a new `modbus_client.py`) that
   reads the real inverter's registers into the same internal shape `main.py`
   already consumes.
4. In `shadow` mode, disable all register *writes* to hardware; keep them as
   InfluxDB recommendations (`sensor.ems_mpc_action` etc. already exist).
5. Keep the simulator runnable (`MODE=sim`) so you can develop and test offline
   forever — that's its lasting value.

## 7. What stays valuable forever

Even fully migrated, the simulator remains useful as:
- An **offline test rig** for new strategies before they touch real hardware.
- A **CI environment** (deterministic, no hardware needed — see `.github/`).
- A **training ground** for the RL agent (safe ε-greedy exploration).
- A **demo / onboarding** tool that needs no physical setup.
