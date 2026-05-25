# EMS Frontend

React + TypeScript dashboard for the EMS simulator. Connects to Home Assistant via WebSocket.

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

## Stack

- **React 19** + **TypeScript**
- **Vite** (bundler)
- **shadcn/ui** (Radix primitives + Tailwind CSS v4)
- **recharts** (line charts)
- **lucide-react** (icons)
- **react-i18next** + **i18next-browser-languagedetector** (i18n)
- **home-assistant-js-websocket** (HA WebSocket API)
