// Event log API — talks to the simulator's health server (/events, port 8088).

const SIM_URL = import.meta.env.VITE_SIM_URL || "http://localhost:8088"

export type EventCategory = "anomaly" | "rule" | "security" | "energy" | "media" | "grid"
export type EventSeverity = "info" | "warning" | "critical"

export interface LogEvent {
  id: number
  ts: number          // epoch seconds
  category: EventCategory
  severity: EventSeverity
  message: string
}

export interface EventsResponse {
  events: LogEvent[]
  stats: { total: number; by_category: Record<string, number> }
  categories: EventCategory[]
  mode?: "live" | "history"
}

export async function fetchEvents(
  opts: { limit?: number; category?: string; since?: number; from?: string; to?: string } = {},
): Promise<EventsResponse> {
  const params = new URLSearchParams()
  if (opts.limit) params.set("limit", String(opts.limit))
  if (opts.category && opts.category !== "all") params.set("category", opts.category)
  if (opts.since) params.set("since", String(opts.since))
  // Historical range (RFC3339 UTC) — switches the backend to an InfluxDB query
  if (opts.from) params.set("from", opts.from)
  if (opts.to) params.set("to", opts.to)

  const res = await fetch(`${SIM_URL}/events?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<EventsResponse>
}
