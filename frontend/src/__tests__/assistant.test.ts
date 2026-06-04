import { describe, it, expect } from "vitest"
import { parseCommand } from "@/lib/assistant"

describe("parseCommand", () => {
  it("returns null for empty or unrecognised input", () => {
    expect(parseCommand("")).toBeNull()
    expect(parseCommand("what's the weather tomorrow")).toBeNull()
  })

  it("toggles the boiler (EN + PL, on/off)", () => {
    expect(parseCommand("turn on the boiler")).toMatchObject({
      domain: "input_boolean", service: "turn_on",
      data: { entity_id: "input_boolean.wirtualny_bojler" }, key: "assistant.done.boilerOn",
    })
    expect(parseCommand("wyłącz bojler")).toMatchObject({
      service: "turn_off", key: "assistant.done.boilerOff",
    })
  })

  it("sets inverter modes, discharge winning over the 'laduj' substring", () => {
    expect(parseCommand("set inverter to charge")).toMatchObject({
      service: "select_option",
      data: { entity_id: "input_select.ems_tryb_inwertera", option: "Force Charge" },
    })
    expect(parseCommand("rozładuj inwerter")).toMatchObject({
      data: { option: "Force Discharge" }, key: "assistant.done.inverterDischarge",
    })
    expect(parseCommand("inwerter auto")).toMatchObject({ data: { option: "Auto" } })
  })

  it("maps presence phrases (PL + EN)", () => {
    expect(parseCommand("wyjeżdżam")).toMatchObject({
      data: { entity_id: "input_select.ems_tryb_obecnosci", option: "Poza domem" },
    })
    expect(parseCommand("jestem w domu")).toMatchObject({ data: { option: "W domu" } })
    expect(parseCommand("vacation mode")).toMatchObject({ data: { option: "Urlop" } })
  })

  it("sets the EV charge limit from a number and clamps it", () => {
    expect(parseCommand("set ev to 5000")).toMatchObject({
      domain: "input_number", service: "set_value",
      data: { entity_id: "input_number.ems_limit_ladowania_ev", value: 5000 },
      key: "assistant.done.evLimit", params: { w: 5000 },
    })
    expect(parseCommand("limit ładowania ev 9999")).toMatchObject({
      data: { value: 7400 },   // clamped to max
    })
  })

  it("toggles the living-room light", () => {
    expect(parseCommand("włącz światło")).toMatchObject({
      data: { entity_id: "input_boolean.wirtualne_swiatlo_salon_glowne" },
      key: "assistant.done.lightOn",
    })
    expect(parseCommand("turn off lamp")).toMatchObject({ key: "assistant.done.lightOff" })
  })

  it("defaults a bare device mention to ON", () => {
    expect(parseCommand("boiler")).toMatchObject({ service: "turn_on" })
  })
})
