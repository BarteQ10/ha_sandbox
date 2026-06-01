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
