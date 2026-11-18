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

/**
 * Local calendar date as YYYY-MM-DD.
 *
 * Deliberately not `toISOString().slice(0, 10)`: a report row is a *local* day —
 * that is what its label says, and what the `*_dzis` sensors reset on — and east
 * of UTC local midnight falls on the previous UTC date. Keying rows by a UTC
 * date made every row show the day before the one it was labelled with, and the
 * current day read nothing at all.
 */
export function isoDate(d: Date) {
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${d.getFullYear()}-${month}-${day}`
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

/**
 * Last numeric state per local calendar date, keyed exactly like isoDate().
 *
 * Home Assistant stamps `last_changed` in UTC, so the string's own date prefix
 * is a UTC date and does not line up with the local-day keys the rows are
 * looked up with — parse it and bucket the reading by the local day it belongs
 * to. Exported so a test can pin that pairing down.
 */
export function lastPerDay(
  series: Array<{ state: string; last_changed: string }>
): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of series) {
    const v = parseFloat(r.state)
    if (isNaN(v)) continue
    const at = new Date(r.last_changed)
    if (isNaN(at.getTime())) continue
    m.set(isoDate(at), v)
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

// ─── period (week / month) report ──────────────────────────────────────────────

export type ReportPeriod = "week" | "month"

export interface PeriodRange {
  start: Date
  days: number
  label: string   // localised period label (e.g. "5 – 11 May 2024" or "May 2024")
}

/** Resolve the calendar range for a week/month at the given offset (0 = current). */
export function periodRange(period: ReportPeriod, offset: number): PeriodRange {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (period === "week") {
    const mon = weekStart(addDays(today, offset * 7))
    const sun = addDays(mon, 6)
    const label =
      `${mon.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })} – ` +
      `${sun.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}`
    return { start: mon, days: 7, label }
  }
  // month
  const ref = new Date(today.getFullYear(), today.getMonth() + offset, 1)
  const days = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate()
  const label = ref.toLocaleDateString("pl-PL", { month: "long", year: "numeric" })
  return { start: ref, days, label }
}

/** DayReport[] for a week or a calendar month, ending at "today" for the current period. */
export function usePeriodReport(period: ReportPeriod, offset: number) {
  const [rows, setRows] = useState<DayReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!cancelled) { setLoading(true); setRows([]) }
      const now = new Date()
      const { start, days } = periodRange(period, offset)
      const lastDay = addDays(start, days - 1)
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const endDate = lastDay >= today ? now : addDays(lastDay, 1)

      const data = await fetchHistoryMulti(WEEK_ENTITIES, start.toISOString(), endDate.toISOString())
      if (cancelled) return

      const pvMap   = lastPerDay(data.get("sensor.ems_energia_pv_riemann")    ?? [])
      const netMap  = lastPerDay(data.get("sensor.ems_energia_netto_riemann") ?? [])
      const costMap = lastPerDay(data.get("sensor.ems_bilans_finansowy_dzis") ?? [])

      const result: DayReport[] = []
      for (let i = 0; i < days; i++) {
        const d = addDays(start, i)
        if (d > now) break
        const date = isoDate(d)
        const pvKwh   = pvMap.get(date)  ?? 0
        const netKwh  = netMap.get(date) ?? 0
        const costPln = costMap.get(date) ?? 0
        const exported = Math.max(0, netKwh)
        const selfPct = pvKwh > 0 ? Math.min(100, ((pvKwh - exported) / pvKwh) * 100) : 0
        result.push({
          date,
          label: period === "week"
            ? d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric" })
            : String(d.getDate()),
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
  }, [period, offset])

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
