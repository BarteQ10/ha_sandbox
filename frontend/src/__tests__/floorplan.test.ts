import { describe, it, expect } from "vitest"
import { anyOn } from "@/components/FloorPlan"
import {
  DEFAULT_LAYOUT, isPlaceable, addDevice, removeDevice, moveDevice, moveRoom,
  resizeRoom, snap, wouldRoomOverlap, GRID, addRoom, removeRoom, renameRoom,
  updateRoom,
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

  it("moveRoom snaps + clamps and allows overlap (no hard lock)", () => {
    // overlap is allowed now so dense layouts stay editable; the move applies
    const salon = DEFAULT_LAYOUT.rooms[0]
    const kuchnia = DEFAULT_LAYOUT.rooms[1]
    const l = moveRoom(DEFAULT_LAYOUT, salon.id, kuchnia.x, kuchnia.y)
    const r = l.rooms.find((x) => x.id === salon.id)!
    expect(r.x).toBe(kuchnia.x)
    expect(r.y).toBe(kuchnia.y)
  })

  it("moveRoom allows a non-overlapping snapped move", () => {
    const salon = DEFAULT_LAYOUT.rooms[0]
    const l = moveRoom(DEFAULT_LAYOUT, salon.id, 0, 0)
    const r = l.rooms.find((x) => x.id === salon.id)!
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
  })

  it("addRoom appends a labelled custom room with no bindings", () => {
    const l = addRoom(DEFAULT_LAYOUT, "Biuro")
    expect(l.rooms.length).toBe(DEFAULT_LAYOUT.rooms.length + 1)
    const r = l.rooms[l.rooms.length - 1]
    expect(r.label).toBe("Biuro")
    expect(r.lights).toEqual([])
    expect(r.temp).toBe("")
  })

  it("removeRoom drops the room by id", () => {
    const id = DEFAULT_LAYOUT.rooms[0].id
    const l = removeRoom(DEFAULT_LAYOUT, id)
    expect(l.rooms.some((r) => r.id === id)).toBe(false)
  })

  it("renameRoom changes the label", () => {
    const id = DEFAULT_LAYOUT.rooms[0].id
    const l = renameRoom(DEFAULT_LAYOUT, id, "Salon główny")
    expect(l.rooms.find((r) => r.id === id)!.label).toBe("Salon główny")
  })

  it("updateRoom binds lights + temp to a (custom) room", () => {
    const withRoom = addRoom(DEFAULT_LAYOUT, "Biuro")
    const id = withRoom.rooms[withRoom.rooms.length - 1].id
    const l = updateRoom(withRoom, id, { lights: ["light.office"], temp: "sensor.office_temp" })
    const r = l.rooms.find((x) => x.id === id)!
    expect(r.lights).toEqual(["light.office"])
    expect(r.temp).toBe("sensor.office_temp")
  })

  it("wouldRoomOverlap detects collisions with other rooms only", () => {
    const salon = DEFAULT_LAYOUT.rooms[0]
    expect(wouldRoomOverlap(DEFAULT_LAYOUT, salon.id, { x: salon.x, y: salon.y, w: salon.w, h: salon.h })).toBe(false)
    const kuchnia = DEFAULT_LAYOUT.rooms[1]
    expect(wouldRoomOverlap(DEFAULT_LAYOUT, salon.id, { x: kuchnia.x, y: kuchnia.y, w: 10, h: 10 })).toBe(true)
  })
})
