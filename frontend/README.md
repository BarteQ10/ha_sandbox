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

| Tab | Description |
|-----|-------------|
| **Dom** | Room cards (Salon, Kuchnia, Sypialnia, Lazienka, Ogrod) with temperature, multi-light controls (dimmer + color temp), blinds slider, humidity. Sub-tabs: Wspolne / Prywatne / Ogrod |
| **System** | EMS views with sub-tabs: Przeplywy (energy flow gauges, stats, device badges, history charts), Sterowanie (inverter, HP, boiler, PV limit, storm, EV), Energia (daily stats, charge window, PV forecast, price history) |

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
