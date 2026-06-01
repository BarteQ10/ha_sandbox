import type { HassEntity } from "home-assistant-js-websocket"

// Scenes = "quick actions" that fan out into many HA service calls. Kept as
// plain data + a pure expander so the logic is testable without React/HA.

export interface ServiceCall {
  domain: string
  service: string
  data: Record<string, unknown>
}

// A step is either a direct service call or a pattern that fans out over the
// matching entities in the live store (so it survives adding/removing lights).
export type SceneStep =
  | { call: ServiceCall }
  | { allLights: "on" | "off" }
  | { allBlinds: number }

export interface Scene {
  id: string
  nameKey: string
  descKey: string
  steps: SceneStep[]
}

const LIGHT_PREFIX = "input_boolean.wirtualne_swiatlo_"
const BLIND_PREFIX = "input_number.wirtualne_rolety_"

// Controllable input_number prefixes worth capturing into a scene (not the
// read-only simulated temperatures or the electricity price).
const NUMBER_PREFIXES = [
  "input_number.wirtualne_rolety_",
  "input_number.wirtualne_jasnosc_",
  "input_number.wirtualne_barwa_",
  "input_number.wirtualne_rgb_",
]
const PRESENCE_ID = "input_select.ems_tryb_obecnosci"

// A user-saved scene captured from the current state of the controllable entities.
export interface StoredScene {
  id: string
  name: string
  color: string
  steps: ServiceCall[]
}

// Snapshot the current state of every controllable entity into a flat list of
// service calls that, when replayed, restore that exact state.
export function captureScene(entities: Record<string, HassEntity>): ServiceCall[] {
  const calls: ServiceCall[] = []
  for (const id of Object.keys(entities).sort()) {
    const e = entities[id]
    const a = (e.attributes ?? {}) as Record<string, unknown>

    if (id.startsWith(LIGHT_PREFIX)) {
      calls.push({ domain: "input_boolean", service: e.state === "on" ? "turn_on" : "turn_off", data: { entity_id: id } })
    } else if (NUMBER_PREFIXES.some((p) => id.startsWith(p))) {
      const v = Number(e.state)
      if (!Number.isNaN(v)) calls.push({ domain: "input_number", service: "set_value", data: { entity_id: id, value: v } })
    } else if (id.startsWith("climate.")) {
      const temp = Number(a.temperature)
      if (!Number.isNaN(temp)) calls.push({ domain: "climate", service: "set_temperature", data: { entity_id: id, temperature: temp } })
      calls.push({ domain: "climate", service: "set_hvac_mode", data: { entity_id: id, hvac_mode: e.state } })
    } else if (id.startsWith("lock.")) {
      calls.push({ domain: "lock", service: e.state === "locked" ? "lock" : "unlock", data: { entity_id: id } })
    } else if (id.startsWith("cover.")) {
      const pos = Number(a.current_position)
      if (!Number.isNaN(pos)) calls.push({ domain: "cover", service: "set_cover_position", data: { entity_id: id, position: pos } })
    } else if (id === PRESENCE_ID) {
      calls.push({ domain: "input_select", service: "select_option", data: { entity_id: id, option: e.state } })
    }
  }
  return calls
}

export function expandScene(
  steps: SceneStep[],
  entities: Record<string, HassEntity>,
): ServiceCall[] {
  const calls: ServiceCall[] = []
  for (const step of steps) {
    if ("call" in step) {
      calls.push(step.call)
    } else if ("allLights" in step) {
      const service = step.allLights === "on" ? "turn_on" : "turn_off"
      Object.keys(entities)
        .filter((id) => id.startsWith(LIGHT_PREFIX))
        .sort()
        .forEach((id) => calls.push({ domain: "input_boolean", service, data: { entity_id: id } }))
    } else if ("allBlinds" in step) {
      Object.keys(entities)
        .filter((id) => id.startsWith(BLIND_PREFIX))
        .sort()
        .forEach((id) => calls.push({
          domain: "input_number", service: "set_value",
          data: { entity_id: id, value: step.allBlinds },
        }))
    }
  }
  return calls
}
