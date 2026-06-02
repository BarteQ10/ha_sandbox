import { describe, it, expect } from "vitest"
import {
  isNumericSeries, toNumericPoints, toSegments, stateColor, type HistRow,
} from "@/lib/history"

const row = (state: string, iso: string): HistRow => ({ state, last_changed: iso })

describe("isNumericSeries", () => {
  it("is true for mostly-numeric states", () => {
    expect(isNumericSeries([row("21.5", "x"), row("22.0", "x"), row("20", "x")])).toBe(true)
  })
  it("is false for on/off states", () => {
    expect(isNumericSeries([row("on", "x"), row("off", "x"), row("on", "x")])).toBe(false)
  })
  it("is false for an empty series", () => {
    expect(isNumericSeries([])).toBe(false)
  })
})

describe("toNumericPoints", () => {
  it("parses time + value and drops invalid rows", () => {
    const pts = toNumericPoints([
      row("21.5", "2026-06-01T10:00:00Z"),
      row("unknown", "2026-06-01T10:05:00Z"),
      row("22", "2026-06-01T10:10:00Z"),
    ])
    expect(pts).toHaveLength(2)
    expect(pts[0].v).toBe(21.5)
    expect(pts[1].v).toBe(22)
    expect(pts[0].t).toBe(Date.parse("2026-06-01T10:00:00Z"))
  })
})

describe("toSegments", () => {
  it("builds contiguous segments, last running to endMs", () => {
    const a = "2026-06-01T10:00:00Z"
    const b = "2026-06-01T10:30:00Z"
    const endMs = Date.parse("2026-06-01T11:00:00Z")
    const segs = toSegments([row("off", a), row("on", b)], endMs)
    expect(segs).toHaveLength(2)
    expect(segs[0]).toMatchObject({ state: "off", start: Date.parse(a), end: Date.parse(b) })
    expect(segs[1]).toMatchObject({ state: "on", start: Date.parse(b), end: endMs })
  })

  it("skips rows with an invalid timestamp", () => {
    const endMs = Date.parse("2026-06-01T11:00:00Z")
    const segs = toSegments([row("on", "nonsense"), row("off", "2026-06-01T10:00:00Z")], endMs)
    expect(segs).toHaveLength(1)
    expect(segs[0].state).toBe("off")
  })
})

describe("stateColor", () => {
  it("maps known states to intent colours", () => {
    expect(stateColor("on")).toBe("#4ade80")
    expect(stateColor("LOCKED")).toBe("#4ade80")
  })
  it("is deterministic for unknown states", () => {
    expect(stateColor("foo")).toBe(stateColor("foo"))
    expect(stateColor("foo")).toMatch(/^hsl\(/)
  })
})
