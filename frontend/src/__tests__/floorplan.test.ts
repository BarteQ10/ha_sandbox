import { describe, it, expect } from "vitest"
import { anyOn } from "@/components/FloorPlan"
import {
  DEFAULT_LAYOUT, isPlaceable, addDevice, removeDevice, moveDevice, moveRoom,
  resizeRoom, snap, wouldRoomOverlap, GRID,
} from "@/lib/floorplan"
import type { HassEntity } from "home-assistant-js-websocket"

function map(states: Record<string, string>): Record<string, HassEntity> {
  return Object.fromEntries(
    Object.entries(states).map(([id, state]) => [id, { entity_id: id, state, attributes: {} } as unknown as HassEntity]),
  )
}

describe("anyOn", () => {
  it("is true when at least one light is on", () => {
    const e = map({ "light.a": "off", "light.b": "on" })
    expect(anyOn(e, ["light.a", "light.b"])).toBe(true)
  })

  it("is false when all are off", () => {
    const e = map({ "light.a": "off", "light.b": "off" })
    expect(anyOn(e, ["light.a", "light.b"])).toBe(false)
  })

  it("ignores missing entities", () => {
    const e = map({ "light.a": "off" })
    expect(anyOn(e, ["light.a", "light.missing"])).toBe(false)
  })

  it("is false for an empty id list", () => {
    expect(anyOn(map({ "light.a": "on" }), [])).toBe(false)
  })
})

describe("floorplan reducers", () => {
  it("isPlaceable accepts controllable/sensor domains, rejects others", () => {
    expect(isPlaceable("lock.front")).toBe(true)
    expect(isPlaceable("vacuum.robot")).toBe(true)
    expect(isPlaceable("sensor.co2")).toBe(true)
    expect(isPlaceable("automation.x")).toBe(false)
  })

  it("addDevice appends a new device but not duplicates", () => {
    const l1 = addDevice(DEFAULT_LAYOUT, "fan.new")
    expect(l1.devices.length).toBe(DEFAULT_LAYOUT.devices.length + 1)
    const l2 = addDevice(l1, "fan.new")            // duplicate ignored
    expect(l2).toBe(l1)
  })

  it("removeDevice drops by id", () => {
    const id = DEFAULT_LAYOUT.devices[0].id
    const l = removeDevice(DEFAULT_LAYOUT, id)
    expect(l.devices.some((d) => d.id === id)).toBe(false)
  })

  it("moveDevice clamps to 0–100", () => {
    const id = DEFAULT_LAYOUT.devices[0].id
    const l = moveDevice(DEFAULT_LAYOUT, id, 150, -20)
    const d = l.devices.find((x) => x.id === id)!
    expect(d.x).toBe(100)
    expect(d.y).toBe(0)
  })

  it("resizeRoom enforces a minimum size", () => {
    const id = DEFAULT_LAYOUT.rooms[0].id
    const l = resizeRoom(DEFAULT_LAYOUT, id, 2, 2)
    const r = l.rooms.find((x) => x.id === id)!
    expect(r.w).toBe(8)
    expect(r.h).toBe(8)
  })

  it("snap rounds to the grid", () => {
    expect(snap(3)).toBe(GRID * Math.round(3 / GRID))
    expect(snap(GRID * 5)).toBe(GRID * 5)
  })

  it("moveDevice snaps to the grid", () => {
    const id = DEFAULT_LAYOUT.devices[0].id
    const l = moveDevice(DEFAULT_LAYOUT, id, 33.4, 47.9)
    const d = l.devices.find((x) => x.id === id)!
    expect(d.x % GRID).toBe(0)
    expect(d.y % GRID).toBe(0)
  })

  it("moveRoom rejects a position that overlaps another room", () => {
    // move salon (id rooms[0]) onto kuchnia's spot → unchanged
    const salon = DEFAULT_LAYOUT.rooms[0]
    const kuchnia = DEFAULT_LAYOUT.rooms[1]
    const l = moveRoom(DEFAULT_LAYOUT, salon.id, kuchnia.x, kuchnia.y)
    expect(l).toBe(DEFAULT_LAYOUT)
  })

  it("moveRoom allows a non-overlapping snapped move", () => {
    const salon = DEFAULT_LAYOUT.rooms[0]
    const l = moveRoom(DEFAULT_LAYOUT, salon.id, 0, 0)
    const r = l.rooms.find((x) => x.id === salon.id)!
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })

  it("wouldRoomOverlap detects collisions with other rooms only", () => {
    const salon = DEFAULT_LAYOUT.rooms[0]
    expect(wouldRoomOverlap(DEFAULT_LAYOUT, salon.id, { x: salon.x, y: salon.y, w: salon.w, h: salon.h })).toBe(false)
    const kuchnia = DEFAULT_LAYOUT.rooms[1]
    expect(wouldRoomOverlap(DEFAULT_LAYOUT, salon.id, { x: kuchnia.x, y: kuchnia.y, w: 10, h: 10 })).toBe(true)
  })
})
