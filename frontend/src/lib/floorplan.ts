// Floor-plan layout model + pure reducers (testable without React).
// Coordinates are percentages within the plan container.

export interface PlanRoom {
  id: string
  label: string        // i18n key or literal
  color: string
  x: number; y: number; w: number; h: number
  lights: string[]     // input_boolean light entities (for the glow + toggle)
  temp: string         // temperature entity (optional)
}

export interface PlanDevice {
  id: string
  entity: string       // HA entity_id
  x: number; y: number
}

export interface PlanLayout {
  rooms: PlanRoom[]
  devices: PlanDevice[]
}

export const DEFAULT_LAYOUT: PlanLayout = {
  rooms: [
    { id: "salon", label: "rooms.salon", color: "#ffa726", x: 2, y: 2, w: 46, h: 54,
      temp: "input_number.wirtualna_temp_salon",
      lights: ["input_boolean.wirtualne_swiatlo_salon_glowne", "input_boolean.wirtualne_swiatlo_salon_lampa", "input_boolean.wirtualne_swiatlo_salon_led"] },
    { id: "kuchnia", label: "rooms.kitchen", color: "#66bb6a", x: 50, y: 2, w: 30, h: 40,
      temp: "input_number.wirtualna_temp_kuchnia",
      lights: ["input_boolean.wirtualne_swiatlo_kuchnia_glowne", "input_boolean.wirtualne_swiatlo_kuchnia_wyspa", "input_boolean.wirtualne_swiatlo_kuchnia_led"] },
    { id: "sypialnia", label: "rooms.bedroom", color: "#4fc3f7", x: 2, y: 58, w: 46, h: 40,
      temp: "input_number.wirtualna_temp_sypialnia",
      lights: ["input_boolean.wirtualne_swiatlo_sypialnia_glowne", "input_boolean.wirtualne_swiatlo_sypialnia_lampka1", "input_boolean.wirtualne_swiatlo_sypialnia_lampka2", "input_boolean.wirtualne_swiatlo_sypialnia_kinkiet"] },
    { id: "lazienka", label: "rooms.bathroom", color: "#ce93d8", x: 50, y: 44, w: 30, h: 54,
      temp: "input_number.wirtualna_temp_lazienka",
      lights: ["input_boolean.wirtualne_swiatlo_lazienka_glowne", "input_boolean.wirtualne_swiatlo_lazienka_lustro"] },
    { id: "ogrod", label: "rooms.garden", color: "#81c784", x: 82, y: 2, w: 16, h: 96,
      temp: "input_number.wirtualna_temp_ogrod",
      lights: ["input_boolean.wirtualne_swiatlo_ogrod_glowne", "input_boolean.wirtualne_swiatlo_ogrod_solarne"] },
  ],
  devices: [
    { id: "d_lock",   entity: "lock.ems_simulator_entrance_lock",      x: 49, y: 52 },
    { id: "d_door",   entity: "binary_sensor.ems_simulator_entrance_door", x: 44, y: 52 },
    { id: "d_window", entity: "binary_sensor.ems_simulator_living_window", x: 24, y: 5 },
    { id: "d_gate",   entity: "cover.ems_simulator_driveway_gate",     x: 90, y: 22 },
    { id: "d_garage", entity: "cover.ems_simulator_garage_door",       x: 90, y: 72 },
    { id: "d_motion", entity: "binary_sensor.ems_czujnik_ruchu_zewnetrzny", x: 90, y: 48 },
    { id: "d_smoke",  entity: "binary_sensor.ems_simulator_smoke_detector", x: 40, y: 10 },
    { id: "d_co",     entity: "binary_sensor.ems_simulator_co_detector",    x: 66, y: 10 },
    { id: "d_leak",   entity: "binary_sensor.ems_simulator_kitchen_leak",   x: 66, y: 34 },
    { id: "d_vacuum", entity: "vacuum.ems_simulator_robot_vacuum",     x: 22, y: 30 },
  ],
}

// Invisible snap grid (percent). Positions/sizes snap to multiples of GRID so
// rooms and markers line up cleanly and rooms tile without sloppy overlaps.
export const GRID = 2
export const snap = (v: number) => Math.round(v / GRID) * GRID
const clampPct = (v: number) => Math.max(0, Math.min(100, v))
const MIN_ROOM = 8

interface Rect { x: number; y: number; w: number; h: number }
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

// Would a room at the given rect overlap any *other* room?
export function wouldRoomOverlap(layout: PlanLayout, id: string, rect: Rect): boolean {
  return layout.rooms.some((r) => r.id !== id && rectsOverlap(rect, r))
}

// Domains that can be placed as a marker on the plan.
export const PLACEABLE_DOMAINS = [
  "lock", "cover", "vacuum", "fan", "climate", "switch", "light",
  "input_boolean", "binary_sensor", "sensor",
]

export function isPlaceable(entityId: string): boolean {
  const domain = entityId.split(".")[0]
  return PLACEABLE_DOMAINS.includes(domain)
}

const ROOM_PALETTE = ["#ffa726", "#66bb6a", "#4fc3f7", "#ce93d8", "#81c784", "#f06292", "#9575cd", "#4db6ac"]

// Best-effort: first grid spot where a w×h room doesn't overlap any room.
function findFreeSpot(layout: PlanLayout, w: number, h: number): { x: number; y: number } {
  for (let y = 0; y <= 100 - h; y += GRID * 2) {
    for (let x = 0; x <= 100 - w; x += GRID * 2) {
      if (!wouldRoomOverlap(layout, "__new__", { x, y, w, h })) return { x, y }
    }
  }
  return { x: 40, y: 40 }   // dense layout → place at centre; user can drag it
}

export function addRoom(layout: PlanLayout, label: string): PlanLayout {
  const w = 16, h = 16
  const { x, y } = findFreeSpot(layout, w, h)
  const room: PlanRoom = {
    id: `r_${Date.now()}`,
    label: label || "Pokój",
    color: ROOM_PALETTE[layout.rooms.length % ROOM_PALETTE.length],
    x, y, w, h, lights: [], temp: "",
  }
  return { ...layout, rooms: [...layout.rooms, room] }
}

export function removeRoom(layout: PlanLayout, id: string): PlanLayout {
  return { ...layout, rooms: layout.rooms.filter((r) => r.id !== id) }
}

export function renameRoom(layout: PlanLayout, id: string, label: string): PlanLayout {
  return { ...layout, rooms: layout.rooms.map((r) => (r.id === id ? { ...r, label } : r)) }
}

// Patch arbitrary room fields (lights binding, temp entity, …).
export function updateRoom(layout: PlanLayout, id: string, patch: Partial<PlanRoom>): PlanLayout {
  return { ...layout, rooms: layout.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) }
}

export function addDevice(layout: PlanLayout, entity: string): PlanLayout {
  if (layout.devices.some((d) => d.entity === entity)) return layout
  const device: PlanDevice = { id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, entity, x: 50, y: 50 }
  return { ...layout, devices: [...layout.devices, device] }
}

export function removeDevice(layout: PlanLayout, id: string): PlanLayout {
  return { ...layout, devices: layout.devices.filter((d) => d.id !== id) }
}

export function moveDevice(layout: PlanLayout, id: string, x: number, y: number): PlanLayout {
  const nx = clampPct(snap(x)), ny = clampPct(snap(y))
  return {
    ...layout,
    devices: layout.devices.map((d) => (d.id === id ? { ...d, x: nx, y: ny } : d)),
  }
}

// Snap + clamp to the plan. Overlap is allowed (the grid keeps things tidy);
// a hard no-overlap lock made dense layouts un-editable, so it was removed.
export function moveRoom(layout: PlanLayout, id: string, x: number, y: number): PlanLayout {
  const room = layout.rooms.find((r) => r.id === id)
  if (!room) return layout
  const nx = Math.max(0, Math.min(100 - room.w, snap(x)))
  const ny = Math.max(0, Math.min(100 - room.h, snap(y)))
  return { ...layout, rooms: layout.rooms.map((r) => (r.id === id ? { ...r, x: nx, y: ny } : r)) }
}

export function resizeRoom(layout: PlanLayout, id: string, w: number, h: number): PlanLayout {
  const room = layout.rooms.find((r) => r.id === id)
  if (!room) return layout
  const nw = Math.max(MIN_ROOM, Math.min(100 - room.x, snap(w)))
  const nh = Math.max(MIN_ROOM, Math.min(100 - room.y, snap(h)))
  return { ...layout, rooms: layout.rooms.map((r) => (r.id === id ? { ...r, w: nw, h: nh } : r)) }
}
