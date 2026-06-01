import { describe, it, expect } from "vitest"
import { deriveAlarms } from "@/lib/alarms"
import type { HassEntity } from "home-assistant-js-websocket"

function ent(id: string, state: string, attrs: Record<string, unknown> = {}): HassEntity {
  return { entity_id: id, state, attributes: attrs } as unknown as HassEntity
}

function map(...es: HassEntity[]): Record<string, HassEntity> {
  return Object.fromEntries(es.map((e) => [e.entity_id, e]))
}

describe("deriveAlarms", () => {
  it("returns nothing for an empty map", () => {
    expect(deriveAlarms({})).toEqual([])
  })

  it("flags smoke / CO / gas / leak binary sensors that are on", () => {
    const a = deriveAlarms(map(
      ent("binary_sensor.s", "on", { device_class: "smoke" }),
      ent("binary_sensor.c", "on", { device_class: "carbon_monoxide" }),
      ent("binary_sensor.g", "on", { device_class: "gas" }),
      ent("binary_sensor.m", "on", { device_class: "moisture" }),
    ))
    expect(a.map((x) => x.labelKey).sort()).toEqual([
      "alarms.co", "alarms.gas", "alarms.leak", "alarms.smoke",
    ])
    expect(a.every((x) => x.severity === "critical")).toBe(true)
  })

  it("ignores safety sensors that are off", () => {
    expect(deriveAlarms(map(ent("binary_sensor.s", "off", { device_class: "smoke" })))).toEqual([])
  })

  it("ignores non-critical device classes (e.g. window)", () => {
    expect(deriveAlarms(map(ent("binary_sensor.w", "on", { device_class: "window" })))).toEqual([])
  })

  it("flags a grid blackout (status == 1) only", () => {
    expect(deriveAlarms(map(ent("sensor.ems_status_sieci", "1"))))
      .toEqual([{ key: "blackout", labelKey: "alarms.blackout", severity: "critical" }])
    expect(deriveAlarms(map(ent("sensor.ems_status_sieci", "0")))).toEqual([])
  })

  it("flags low SoC at or below the threshold as a warning", () => {
    expect(deriveAlarms(map(ent("sensor.sztuczny_stan_baterii_soc", "10")))[0]).toMatchObject({
      key: "low_soc", severity: "warning",
    })
    expect(deriveAlarms(map(ent("sensor.sztuczny_stan_baterii_soc", "11")))).toEqual([])
  })

  it("uses the entity_id as the key so multiple sensors are distinct", () => {
    const a = deriveAlarms(map(
      ent("binary_sensor.kitchen", "on", { device_class: "smoke" }),
      ent("binary_sensor.hall", "on", { device_class: "smoke" }),
    ))
    expect(a.map((x) => x.key).sort()).toEqual(["binary_sensor.hall", "binary_sensor.kitchen"])
  })
})
