import { describe, it, expect } from "vitest"
import { addDays, isoDate, weekStart, weekTotals, type DayReport } from "@/hooks/useWeekReport"

describe("addDays", () => {
  it("adds positive days", () => {
    const d = new Date("2026-05-31T00:00:00Z")
    expect(isoDate(addDays(d, 1))).toBe("2026-06-01")
  })
  it("subtracts with negative days", () => {
    const d = new Date("2026-05-31T00:00:00Z")
    expect(isoDate(addDays(d, -1))).toBe("2026-05-30")
  })
  it("does not mutate the input", () => {
    const d = new Date("2026-05-31T00:00:00Z")
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
