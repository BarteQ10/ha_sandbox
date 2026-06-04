# EMS Frontend

React + TypeScript dashboard for the EMS simulator. Connects to Home Assistant via WebSocket for live state + service calls.

## Setup

```bash
cp .env.example .env
# Edit .env — set VITE_HA_TOKEN from http://localhost:8123/profile
npm install
npm run dev
```

Open `http://localhost:5173`.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server with HMR |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | ESLint check |
| `npx tsc --noEmit` | TypeScript check |

## ENV

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_HA_URL` | `http://localhost:8123` | Home Assistant URL |
| `VITE_HA_TOKEN` | (required) | Long-lived access token from HA profile |

## Views

Top-level navigation is split into five themed sections, each with its own sub-tabs
(icon-only on mobile, icon+label on ≥ sm):

| Section | Sub-tabs |
|---------|----------|
| **Dom** | **Plan** (editable interactive floor plan — rooms glow when lit + show temperature, tap to toggle lights, live clickable device markers; edit mode: drag/resize rooms with snap-grid, add/rename/remove rooms, bind lights + temp sensor per room, place any HA entity; layout syncs to the simulator via `/floorplan` with localStorage offline cache + JSON export/import) · room views (Wspolne / Prywatne / Ogrod) · **Media** · **Urzadzenia**, plus a KPI summary + cost-forecast sidebar |
| **Energia** | **Flow** (animated SVG energy-flow + gauges + 12h history) · **Charts** · **Doradca** ("best time to run" — cheapest start hour for washer/dishwasher/EV from RCE price + PV, via `/advisor`) · **Controls** (inverter/HP/grid, boiler/PV/anomaly, presence + V2G + smart socket, storm/EV override, EV limit + degradation) · **Presence** |
| **Monitoring** | **Cameras** (auto-discovered `camera.*` grid) · **Events** (event log from `/events` + history mode) · **History** (per-entity timeline from HA recorder) · **Alerts** (actionable cards, snooze/dismiss) |
| **Analiza** | **Reports** (daily/weekly + CSV export) · **Backtest** (4-strategy comparison via `/backtest`) · **Weather** (GHI + PV forecast) |
| **Ustawienia** | EMS thresholds · notifications (enable toggle + channel status + test + per-category mute) · sound alerts + browser system notifications · system config · tariff zones |

Tab selection is persisted to localStorage; tab labels have tooltips.

### Per-room lighting

Each room card shows individual light toggles with:
- **Dimmer slider** (1-100%) on select lights (lampa stojaca, wyspa, glowne sypialnia, lampki nocne, lustro LED)
- **Color temperature slider** (2700-6500K) on select lights (lampa stojaca, lampki nocne, lustro LED)
- **RGB sliders** (R/G/B 0-255) on LED strips (Salon, Kuchnia)
- **All ON/OFF** quick buttons per room

### Thermostat

Salon, Kuchnia, Sypialnia have +/- target temperature control (16-30°C, step 0.5).

## Stack

- **React 19** + **TypeScript**
- **Vite** (bundler)
- **shadcn/ui** (Radix primitives + Tailwind CSS v4)
- **recharts** (line charts)
- **lucide-react** (icons)
- **react-i18next** + **i18next-browser-languagedetector** (i18n)
- **home-assistant-js-websocket** (HA WebSocket API)
