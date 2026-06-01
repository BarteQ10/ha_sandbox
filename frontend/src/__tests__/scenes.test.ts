import { describe, it, expect } from "vitest"
import { expandScene, captureScene, type SceneStep } from "@/lib/scenes"
import type { HassEntity } from "home-assistant-js-websocket"

function ent(id: string, state = "off", attributes: Record<string, unknown> = {}): HassEntity {
  return { entity_id: id, state, attributes } as unknown as HassEntity
}

function map(...ids: string[]): Record<string, HassEntity> {
  return Object.fromEntries(ids.map((id) => [id, ent(id)]))
}

function emap(...es: HassEntity[]): Record<string, HassEntity> {
  return Object.fromEntries(es.map((e) => [e.entity_id, e]))
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

describe("captureScene", () => {
  it("captures light on/off state", () => {
    const calls = captureScene(emap(
      ent("input_boolean.wirtualne_swiatlo_a", "on"),
      ent("input_boolean.wirtualne_swiatlo_b", "off"),
    ))
    expect(calls).toEqual([
      { domain: "input_boolean", service: "turn_on",  data: { entity_id: "input_boolean.wirtualne_swiatlo_a" } },
      { domain: "input_boolean", service: "turn_off", data: { entity_id: "input_boolean.wirtualne_swiatlo_b" } },
    ])
  })

  it("captures controllable numbers but ignores read-only ones", () => {
    const calls = captureScene(emap(
      ent("input_number.wirtualne_rolety_salon", "60"),
      ent("input_number.wirtualne_jasnosc_salon_lampa", "30"),
      ent("input_number.wirtualna_cena_pradu", "0.8"),   // price → ignored
      ent("input_number.wirtualna_temp_salon", "21.5"),  // sim temp → ignored
    ))
    expect(calls.map((c) => c.data.entity_id)).toEqual([
      "input_number.wirtualne_jasnosc_salon_lampa",
      "input_number.wirtualne_rolety_salon",
    ])
    expect(calls.every((c) => c.service === "set_value")).toBe(true)
  })

  it("captures climate setpoint + mode", () => {
    const calls = captureScene(emap(ent("climate.trv", "heat", { temperature: 22 })))
    expect(calls).toEqual([
      { domain: "climate", service: "set_temperature", data: { entity_id: "climate.trv", temperature: 22 } },
      { domain: "climate", service: "set_hvac_mode",   data: { entity_id: "climate.trv", hvac_mode: "heat" } },
    ])
  })

  it("captures lock, cover and presence", () => {
    const calls = captureScene(emap(
      ent("lock.front", "unlocked"),
      ent("cover.gate", "open", { current_position: 75 }),
      ent("input_select.ems_tryb_obecnosci", "Poza domem"),
    ))
    expect(calls).toContainEqual({ domain: "lock", service: "unlock", data: { entity_id: "lock.front" } })
    expect(calls).toContainEqual({ domain: "cover", service: "set_cover_position", data: { entity_id: "cover.gate", position: 75 } })
    expect(calls).toContainEqual({ domain: "input_select", service: "select_option", data: { entity_id: "input_select.ems_tryb_obecnosci", option: "Poza domem" } })
  })
})
