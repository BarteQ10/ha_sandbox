import { describe, it, expect, vi, beforeEach } from "vitest"

// haClient uses module-level state — import once and test accumulated behaviour
import { getSnapshot, subscribe, getEntitySnapshot, fetchHistory, fetchHistoryMulti } from "@/api/haClient"

describe("getSnapshot()", () => {
  it("returns initial state with empty entities and not connected", () => {
    const snap = getSnapshot()
    expect(snap.connected).toBe(false)
    expect(snap.entities).toEqual({})
  })
})

describe("subscribe()", () => {
  it("returns an unsubscribe function", () => {
    const listener = vi.fn()
    const unsub = subscribe(listener)
    expect(typeof unsub).toBe("function")
    unsub() // should not throw
  })
})

describe("getEntitySnapshot()", () => {
  it("returns undefined for unknown entity", () => {
    expect(getEntitySnapshot("sensor.unknown")).toBeUndefined()
  })

  it("returns same reference on repeated calls with same state", () => {
    const a = getEntitySnapshot("sensor.missing")
    const b = getEntitySnapshot("sensor.missing")
    // Both are undefined but === each other (same cache entry)
    expect(a).toBe(b)
  })
})

// ── fetchHistory parsing ──────────────────────────────────────────────────────

describe("fetchHistory()", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns empty array on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    const result = await fetchHistory("sensor.test", "2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z")
    expect(result).toEqual([])
  })

  it("parses valid numeric states and filters non-numeric", async () => {
    const mockData = [[
      { entity_id: "sensor.test", state: "42.5", last_changed: "2025-01-01T12:00:00Z" },
      { entity_id: "sensor.test", state: "unavailable", last_changed: "2025-01-01T12:01:00Z" },
      { entity_id: "sensor.test", state: "15", last_changed: "2025-01-01T12:02:00Z" },
    ]]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    }))

    const result = await fetchHistory("sensor.test", "2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z")
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ state: "42.5", last_changed: "2025-01-01T12:00:00Z" })
    expect(result[1]).toEqual({ state: "15", last_changed: "2025-01-01T12:02:00Z" })
  })

  it("returns empty array on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    const result = await fetchHistory("sensor.test", "2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z")
    expect(result).toEqual([])
  })
})

describe("fetchHistoryMulti()", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("returns empty map for empty entity list", async () => {
    const result = await fetchHistoryMulti([], "2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z")
    expect(result.size).toBe(0)
  })

  it("parses multiple entity series and filters non-numeric states", async () => {
    const mockData = [
      [
        { entity_id: "sensor.pv", state: "1200", last_changed: "2025-01-01T10:00:00Z" },
        { entity_id: "sensor.pv", state: "unknown", last_changed: "2025-01-01T10:01:00Z" },
      ],
      [
        { entity_id: "sensor.soc", state: "75", last_changed: "2025-01-01T10:00:00Z" },
      ],
    ]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    }))

    const result = await fetchHistoryMulti(
      ["sensor.pv", "sensor.soc"],
      "2025-01-01T00:00:00Z",
      "2025-01-02T00:00:00Z",
    )

    expect(result.size).toBe(2)
    expect(result.get("sensor.pv")).toHaveLength(1)
    expect(result.get("sensor.pv")![0].state).toBe("1200")
    expect(result.get("sensor.soc")).toHaveLength(1)
  })

  it("returns empty map on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const result = await fetchHistoryMulti(["sensor.x"], "2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z")
    expect(result.size).toBe(0)
  })
})
