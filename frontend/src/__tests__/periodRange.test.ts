import { describe, it, expect } from "vitest"
import { periodRange } from "@/hooks/useWeekReport"

describe("periodRange", () => {
  it("returns a 7-day window starting on a Monday for week periods", () => {
    const r = periodRange("week", 0)
    expect(r.days).toBe(7)
    expect(r.start.getDay()).toBe(1)        // Monday
    expect(r.label.length).toBeGreaterThan(0)
  })

  it("returns the correct number of days for the current month", () => {
    const r = periodRange("month", 0)
    const now = new Date()
    const expected = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    expect(r.days).toBe(expected)
    expect(r.start.getDate()).toBe(1)       // first of the month
  })

  it("shifts to a previous month with a negative offset", () => {
    const cur = periodRange("month", 0)
    const prev = periodRange("month", -1)
    // previous month starts strictly before the current month
    expect(prev.start.getTime()).toBeLessThan(cur.start.getTime())
    expect([28, 29, 30, 31]).toContain(prev.days)
  })

  it("shifts week windows by 7 days per offset", () => {
    const cur = periodRange("week", 0)
    const prev = periodRange("week", -1)
    const diffDays = Math.round((cur.start.getTime() - prev.start.getTime()) / 86_400_000)
    expect(diffDays).toBe(7)
  })
})
