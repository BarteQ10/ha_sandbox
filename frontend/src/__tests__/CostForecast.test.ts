import { describe, it, expect } from "vitest"
import { projectWeekCost } from "@/components/CostForecast"
import type { DayReport } from "@/hooks/useWeekReport"

function day(date: string, costPln: number): DayReport {
  return { date, label: date, pvKwh: 0, netKwh: 0, costPln, selfPct: 0 }
}

const TODAY = "2026-05-31"

describe("projectWeekCost", () => {
  it("returns zeros for empty input", () => {
    const p = projectWeekCost([], TODAY)
    expect(p).toEqual({ weekProjected: 0, avgDaily: 0, completedDays: 0 })
  })

  it("uses today's value as the average when no day is completed yet", () => {
    // only today, partial
    const rows = [day(TODAY, -2)]
    const p = projectWeekCost(rows, TODAY)
    expect(p.completedDays).toBe(0)
    expect(p.avgDaily).toBe(-2)
    expect(p.weekProjected).toBeCloseTo(-2 * 7) // avg × 7 remaining
  })

  it("averages completed days and projects the rest", () => {
    const rows = [
      day("2026-05-29", -3),
      day("2026-05-30", -1),
      day(TODAY, -0.5), // today partial — excluded from the average
    ]
    const p = projectWeekCost(rows, TODAY)
    expect(p.completedDays).toBe(2)
    expect(p.avgDaily).toBeCloseTo(-2)           // (-3 + -1) / 2
    // completedSum (-4) + avg(-2) × remaining(5 = today + 4 future)
    expect(p.weekProjected).toBeCloseTo(-4 + -2 * 5)
  })

  it("preserves a positive (revenue) sign", () => {
    const rows = [day("2026-05-29", 1.5), day("2026-05-30", 2.5)]
    const p = projectWeekCost(rows, TODAY)
    expect(p.avgDaily).toBeCloseTo(2)
    expect(p.weekProjected).toBeGreaterThan(0)
  })

  it("treats a full week of completed days as pure actuals", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      day(`2026-05-${20 + i}`, -1),
    )
    const p = projectWeekCost(rows, TODAY) // all dates < TODAY
    expect(p.completedDays).toBe(7)
    expect(p.weekProjected).toBeCloseTo(-7) // no estimation, remaining = 0
  })
})
