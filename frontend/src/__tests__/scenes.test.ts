import { describe, it, expect } from "vitest"
import { expandScene, type SceneStep } from "@/lib/scenes"
import type { HassEntity } from "home-assistant-js-websocket"

function ent(id: string): HassEntity {
  return { entity_id: id, state: "off", attributes: {} } as unknown as HassEntity
}

function map(...ids: string[]): Record<string, HassEntity> {
  return Object.fromEntries(ids.map((id) => [id, ent(id)]))
}

describe("expandScene", () => {
  it("passes direct service calls through unchanged", () => {
    const steps: SceneStep[] = [
      { call: { domain: "lock", service: "lock", data: { entity_id: "lock.front" } } },
    ]
    expect(expandScene(steps, {})).toEqual([
      { domain: "lock", service: "lock", data: { entity_id: "lock.front" } },
    ])
  })

  it("fans out allLights over every light toggle", () => {
    const entities = map(
      "input_boolean.wirtualne_swiatlo_salon_glowne",
      "input_boolean.wirtualne_swiatlo_kuchnia_glowne",
      "input_boolean.wirtualny_bojler",      // not a light → ignored
      "light.real_bulb",                     // different domain → ignored
    )
    const calls = expandScene([{ allLights: "off" }], entities)
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.domain === "input_boolean" && c.service === "turn_off")).toBe(true)
    expect(calls.map((c) => c.data.entity_id)).toEqual([
      "input_boolean.wirtualne_swiatlo_kuchnia_glowne",
      "input_boolean.wirtualne_swiatlo_salon_glowne",
    ])
  })

  it("turns lights on when allLights is 'on'", () => {
    const calls = expandScene([{ allLights: "on" }], map("input_boolean.wirtualne_swiatlo_x"))
    expect(calls[0]).toMatchObject({ service: "turn_on" })
  })

  it("fans out allBlinds with the given value", () => {
    const entities = map(
      "input_number.wirtualne_rolety_salon",
      "input_number.wirtualne_rolety_kuchnia",
      "input_number.wirtualna_cena_pradu",   // not a blind → ignored
    )
    const calls = expandScene([{ allBlinds: 0 }], entities)
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.service === "set_value" && c.data.value === 0)).toBe(true)
  })

  it("preserves order across mixed steps", () => {
    const steps: SceneStep[] = [
      { call: { domain: "input_select", service: "select_option", data: { entity_id: "x", option: "Poza domem" } } },
      { allLights: "off" },
    ]
    const calls = expandScene(steps, map("input_boolean.wirtualne_swiatlo_a"))
    expect(calls.map((c) => c.domain)).toEqual(["input_select", "input_boolean"])
  })

  it("returns an empty list for no steps", () => {
    expect(expandScene([], map("input_boolean.wirtualne_swiatlo_a"))).toEqual([])
  })
})
