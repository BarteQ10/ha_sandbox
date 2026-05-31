import { useEffect, useState } from "react"
import { fetchHistoryMulti } from "@/api/haClient"

// ─── types ───────────────────────────────────────────────────────────────────

export interface DayReport {
  date: string              // YYYY-MM-DD
  label: string             // localised short label
  pvKwh: number
  netKwh: number            // + export, − import
  costPln: number           // + revenue, − spending
  selfPct: number           // self-consumption %
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export const WEEK_ENTITIES = [
  "sensor.ems_energia_pv_riemann",
  "sensor.ems_energia_netto_riemann",
  "sensor.ems_bilans_finansowy_dzis",
]

export function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export function weekStart(ref: Date): Date {
  const d = new Date(ref)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday
  d.setHours(0, 0, 0, 0)
  return d
}

/** Last numeric state per calendar date (YYYY-MM-DD) */
function lastPerDay(series: Array<{ state: string; last_changed: string }>): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of series) {
    const v = parseFloat(r.state)
    if (!isNaN(v)) m.set(r.last_changed.slice(0, 10), v)
  }
  return m
}

// ─── hook ────────────────────────────────────────────────────────────────────

export function useWeekReport(weekOffset: number) {
  const [rows, setRows] = useState<DayReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!cancelled) { setLoading(true); setRows([]) }
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const mon = weekStart(addDays(today, weekOffset * 7))
      const sun = addDays(mon, 6)
      // Fetch from Monday 00:00 to end of Sunday (or now if current week)
      const endDate = weekOffset === 0 ? new Date() : addDays(sun, 1)
      const startIso = mon.toISOString()
      const endIso = endDate.toISOString()

      const data = await fetchHistoryMulti(WEEK_ENTITIES, startIso, endIso)
      if (cancelled) return

      const pvMap   = lastPerDay(data.get("sensor.ems_energia_pv_riemann")    ?? [])
      const netMap  = lastPerDay(data.get("sensor.ems_energia_netto_riemann") ?? [])
      const costMap = lastPerDay(data.get("sensor.ems_bilans_finansowy_dzis") ?? [])

      const result: DayReport[] = []
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i)
        if (d > new Date()) break
        const date = isoDate(d)
        const pvKwh   = pvMap.get(date)  ?? 0
        const netKwh  = netMap.get(date) ?? 0
        const costPln = costMap.get(date) ?? 0
        const exported = Math.max(0, netKwh)
        const selfPct = pvKwh > 0 ? Math.min(100, ((pvKwh - exported) / pvKwh) * 100) : 0
        result.push({
          date,
          label: d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric" }),
          pvKwh,
          netKwh,
          costPln,
          selfPct: Math.round(selfPct * 10) / 10,
        })
      }
      if (!cancelled) {
        setRows(result)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [weekOffset])

  return { rows, loading }
}

// ─── aggregate helper ──────────────────────────────────────────────────────────

export function weekTotals(rows: DayReport[]) {
  const totalPv   = rows.reduce((s, r) => s + r.pvKwh, 0)
  const totalCost = rows.reduce((s, r) => s + r.costPln, 0)
  const totalNet  = rows.reduce((s, r) => s + r.netKwh, 0)
  const avgSelf   = rows.length ? rows.reduce((s, r) => s + r.selfPct, 0) / rows.length : 0
  return { totalPv, totalCost, totalNet, avgSelf }
}
