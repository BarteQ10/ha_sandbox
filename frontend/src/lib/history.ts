// Pure helpers for turning HA history rows into a numeric series or a state
// timeline (segments). Testable without React.

export interface HistRow { state: string; last_changed: string }

// Treat as numeric if most rows parse to finite numbers.
export function isNumericSeries(rows: HistRow[]): boolean {
  if (rows.length === 0) return false
  const numeric = rows.filter((r) => Number.isFinite(Number(r.state))).length
  return numeric >= rows.length * 0.6
}

export interface NumPoint { t: number; v: number }
export function toNumericPoints(rows: HistRow[]): NumPoint[] {
  return rows
    .map((r) => ({ t: Date.parse(r.last_changed), v: Number(r.state) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
}

export interface Segment { state: string; start: number; end: number }
// Build contiguous state segments; the last one runs to `endMs` (now).
export function toSegments(rows: HistRow[], endMs: number): Segment[] {
  const segs: Segment[] = []
  for (let i = 0; i < rows.length; i++) {
    const start = Date.parse(rows[i].last_changed)
    if (!Number.isFinite(start)) continue
    const end = i + 1 < rows.length ? Date.parse(rows[i + 1].last_changed) : endMs
    if (end > start) segs.push({ state: rows[i].state, start, end })
  }
  return segs
}

// Stable colour for a discrete state — known ones get intent colours, the rest
// hash to a pastel hue.
const STATE_COLOR: Record<string, string> = {
  on: "#4ade80", off: "#3f3f46",
  locked: "#4ade80", unlocked: "#fbbf24",
  open: "#fbbf24", closed: "#3f3f46", closing: "#a1a1aa", opening: "#a1a1aa",
  home: "#4ade80", cleaning: "#4ade80", docked: "#3f3f46", returning: "#60a5fa",
}
export function stateColor(state: string): string {
  const known = STATE_COLOR[state.toLowerCase()]
  if (known) return known
  let h = 0
  for (let i = 0; i < state.length; i++) h = (h * 31 + state.charCodeAt(i)) % 360
  return `hsl(${h}, 55%, 55%)`
}
