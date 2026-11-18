import { describe, it, expect } from "vitest"
import {
  addDays,
  isoDate,
  lastPerDay,
  weekStart,
  weekTotals,
  type DayReport,
} from "@/hooks/useWeekReport"

describe("addDays", () => {
  it("adds positive days", () => {
    const d = new Date(2026, 4, 31)
    expect(isoDate(addDays(d, 1))).toBe("2026-06-01")
  })
  it("subtracts with negative days", () => {
    const d = new Date(2026, 4, 31)
    expect(isoDate(addDays(d, -1))).toBe("2026-05-30")
  })
  it("does not mutate the input", () => {
    const d = new Date(2026, 4, 31)
    addDays(d, 5)
    expect(isoDate(d)).toBe("2026-05-31")
  })
})

describe("weekStart", () => {
  it("returns Monday for a mid-week date", () => {
    // 2026-05-31 is a Sunday → Monday is 2026-05-25
    const mon = weekStart(new Date("2026-05-31T12:00:00"))
    expect(mon.getDay()).toBe(1) // Monday
  })
  it("returns same Monday for a Monday input", () => {
    const mon = weekStart(new Date("2026-05-25T09:00:00"))
    expect(mon.getDay()).toBe(1)
    expect(mon.getHours()).toBe(0)
  })
})

describe("weekTotals", () => {
  const rows: DayReport[] = [
    { date: "2026-05-25", label: "Mon", pvKwh: 10, netKwh: 4,  costPln: 2.5,  selfPct: 60 },
    { date: "2026-05-26", label: "Tue", pvKwh: 8,  netKwh: -2, costPln: -1.0, selfPct: 80 },
    { date: "2026-05-27", label: "Wed", pvKwh: 12, netKwh: 6,  costPln: 3.5,  selfPct: 50 },
  ]

  it("sums PV", () => {
    expect(weekTotals(rows).totalPv).toBe(30)
  })
  it("sums cost (revenue − spend)", () => {
    expect(weekTotals(rows).totalCost).toBeCloseTo(5.0)
  })
  it("sums net energy", () => {
    expect(weekTotals(rows).totalNet).toBe(8)
  })
  it("averages self-consumption", () => {
    expect(weekTotals(rows).avgSelf).toBeCloseTo(63.333, 2)
  })
  it("handles empty input without NaN", () => {
    const t = weekTotals([])
    expect(t.totalPv).toBe(0)
    expect(t.avgSelf).toBe(0)
  })
})

describe("isoDate / lastPerDay", () => {
  // The hook looks a row up by isoDate(local midnight) in a map lastPerDay()
  // built from Home Assistant's UTC `last_changed` stamps. If the two disagree
  // on where a day starts, every row silently shows the previous day and the
  // current one reads nothing — which is what a UTC isoDate() used to do east
  // of UTC. These cases are timezone-independent: both sides stay local.
  const localDay = (y: number, m: number, d: number) => new Date(y, m, d)
  const stampedAt = (y: number, m: number, d: number, h: number) =>
    new Date(y, m, d, h).toISOString()

  it("formats a local date without shifting it", () => {
    expect(isoDate(localDay(2026, 0, 1))).toBe("2026-01-01")
    expect(isoDate(localDay(2026, 10, 16))).toBe("2026-11-16")
  })

  it("finds a reading stamped late in a local day under that day's key", () => {
    const map = lastPerDay([{ state: "12.5", last_changed: stampedAt(2026, 10, 16, 23) }])
    expect(map.get(isoDate(localDay(2026, 10, 16)))).toBe(12.5)
  })

  it("keeps consecutive local days in separate buckets", () => {
    const map = lastPerDay([
      { state: "1", last_changed: stampedAt(2026, 10, 16, 23) },
      { state: "2", last_changed: stampedAt(2026, 10, 17, 23) },
    ])
    expect(map.get(isoDate(localDay(2026, 10, 16)))).toBe(1)
    expect(map.get(isoDate(localDay(2026, 10, 17)))).toBe(2)
  })

  it("keeps the last reading of each day", () => {
    const map = lastPerDay([
      { state: "1", last_changed: stampedAt(2026, 10, 16, 8) },
      { state: "9", last_changed: stampedAt(2026, 10, 16, 23) },
    ])
    expect(map.get(isoDate(localDay(2026, 10, 16)))).toBe(9)
  })

  it("skips unparseable states and timestamps", () => {
    const map = lastPerDay([
      { state: "unavailable", last_changed: stampedAt(2026, 10, 16, 8) },
      { state: "3", last_changed: "not-a-date" },
    ])
    expect(map.size).toBe(0)
  })
})
