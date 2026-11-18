// Backtest API — talks to the simulator's health/metrics HTTP server (port 8088),
// a different origin than HA. The server sends CORS headers (Access-Control-Allow-Origin).

import { SIM_BASE, simHeaders } from "./base"
const SIM_URL = SIM_BASE

export interface BacktestStrategy {
  name: string
  cost_pln: number
  savings_pct: number
  import_kwh: number
  export_kwh: number
  self_sufficiency: number
  charge_cycles: number
  cumulative_cost: number[]
}

export interface BacktestResult {
  days: number
  rows: number
  from: string
  to: string
  strategies: BacktestStrategy[]
  best: string
  savings_pln: number
  savings_year_est: number
  timeline: string[]
}

export interface BacktestError {
  error: string
  detail?: string
  days?: number
}

export async function runBacktest(days: number): Promise<BacktestResult> {
  const res = await fetch(`${SIM_URL}/backtest?days=${days}`, {
    method: "GET",
    headers: simHeaders({ Accept: "application/json" }),
  })
  const json = await res.json()
  if (!res.ok || "error" in json) {
    const err = json as BacktestError
    throw new Error(err.error === "no_data"
      ? "no_data"
      : err.detail || err.error || `HTTP ${res.status}`)
  }
  return json as BacktestResult
}
