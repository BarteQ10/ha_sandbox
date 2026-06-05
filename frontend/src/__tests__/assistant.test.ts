import { describe, it, expect } from "vitest"
import {
  parseCommand, intentToCommand, disambiguate, matchScene, resolveFollowUp, parseQuery,
} from "@/lib/assistant"

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

  it("controls the light in the named room", () => {
    expect(parseCommand("zapal światło w kuchni")).toMatchObject({
      domain: "input_boolean", service: "turn_on",
      data: { entity_id: "input_boolean.wirtualne_swiatlo_kuchnia_glowne" },
      key: "assistant.done.lightOn", params: { roomId: "kuchnia" }, intent: "light_on",
    })
    expect(parseCommand("zgaś światło w sypialni")).toMatchObject({
      service: "turn_off",
      data: { entity_id: "input_boolean.wirtualne_swiatlo_sypialnia_glowne" },
      params: { roomId: "sypialnia" },
    })
    // no room named → defaults to the living room
    expect(parseCommand("włącz światło")).toMatchObject({
      data: { entity_id: "input_boolean.wirtualne_swiatlo_salon_glowne" },
      params: { roomId: "salon" },
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

  it("handles absolute and relative temperature commands", () => {
    expect(parseCommand("ustaw temperaturę na 23", { salonTemp: 20 })).toMatchObject({
      domain: "input_number", service: "set_value",
      data: { entity_id: "input_number.wirtualne_ustawienie_temp_salon", value: 23 },
      key: "assistant.done.setTemp", params: { t: 23 },
    })
    // relative commands resolve against the current setpoint from ctx
    expect(parseCommand("zwiększ temperaturę", { salonTemp: 21 })).toMatchObject({
      data: { value: 22 }, key: "assistant.done.tempUp",
    })
    expect(parseCommand("zrób chłodniej", { salonTemp: 21 })).toMatchObject({
      data: { value: 20 }, key: "assistant.done.tempDown",
    })
  })

  it("does not mistake 'podgrzej wodę' for a temperature command", () => {
    // "podgrzej" contains "grzej" — must NOT trigger temp_up; it's a boiler
    // phrase that should fall through to the LLM (parser returns null).
    expect(parseCommand("podgrzej wodę w zbiorniku", { salonTemp: 21 })).toBeNull()
  })

  it("clamps temperature to the 16–30°C range", () => {
    expect(intentToCommand("set_temp", 99)).toMatchObject({ data: { value: 30 } })
    expect(intentToCommand("temp_down", null, { salonTemp: 16 })).toMatchObject({ data: { value: 16 } })
  })

  it("targets temperature by room", () => {
    expect(parseCommand("ustaw temperaturę na 22 w kuchni", { temps: { kuchnia: 18 } })).toMatchObject({
      data: { entity_id: "input_number.wirtualne_ustawienie_temp_kuchnia", value: 22 },
      key: "assistant.done.setTemp", params: { roomId: "kuchnia", t: 22 },
    })
    expect(parseCommand("cieplej w sypialni", { temps: { sypialnia: 19 } })).toMatchObject({
      key: "assistant.done.tempUp", params: { roomId: "sypialnia", t: 20 },
    })
  })

  it("opens and closes blinds per room", () => {
    expect(parseCommand("zamknij rolety w kuchni")).toMatchObject({
      domain: "input_number", service: "set_value",
      data: { entity_id: "input_number.wirtualne_rolety_kuchnia", value: 0 },
      key: "assistant.done.blindsClose", params: { roomId: "kuchnia" }, intent: "blinds_close",
    })
    expect(parseCommand("otwórz rolety")).toMatchObject({
      data: { entity_id: "input_number.wirtualne_rolety_salon", value: 100 },
      key: "assistant.done.blindsOpen", params: { roomId: "salon" },
    })
  })

  it("sets heat-pump mode", () => {
    expect(parseCommand("ustaw pompę ciepła na boost")).toMatchObject({
      domain: "input_select", service: "select_option",
      data: { entity_id: "input_select.ems_tryb_pompy_ciepla", option: "Boost" },
      key: "assistant.done.hpBoost",
    })
    expect(parseCommand("wyłącz pompę ciepła")).toMatchObject({ data: { option: "Wylaczona" } })
  })

  it("toggles V2G and EV override", () => {
    expect(parseCommand("włącz v2g")).toMatchObject({
      domain: "input_boolean", service: "turn_on",
      data: { entity_id: "input_boolean.ems_v2g_mode" }, key: "assistant.done.v2gOn",
    })
    expect(parseCommand("wymuś ładowanie auta")).toMatchObject({
      service: "turn_on", data: { entity_id: "input_boolean.ems_ev_override" },
    })
  })

  it("curtails PV export (switch domain)", () => {
    expect(parseCommand("ogranicz eksport PV")).toMatchObject({
      domain: "switch", service: "turn_on",
      data: { entity_id: "switch.ems_ograniczenie_pv" }, key: "assistant.done.pvCurtailOn",
    })
  })

  it("sets grid status", () => {
    expect(parseCommand("ustaw blackout")).toMatchObject({
      data: { entity_id: "input_select.ems_status_sieci", option: "Blackout" },
      key: "assistant.done.gridBlackout",
    })
  })

  it("controls the media player", () => {
    expect(parseCommand("zatrzymaj muzykę")).toMatchObject({
      domain: "media_player", service: "media_stop", key: "assistant.done.mediaStop",
    })
    expect(parseCommand("następny utwór")).toMatchObject({ service: "media_next_track" })
    expect(parseCommand("ścisz")).toMatchObject({ service: "volume_down" })
    expect(parseCommand("ustaw głośność na 40%")).toMatchObject({
      service: "volume_set", data: { volume_level: 0.4 }, params: { v: 40 },
    })
    expect(parseCommand("wycisz muzykę")).toMatchObject({
      service: "volume_mute", data: { is_volume_muted: true },
    })
  })

  it("targets the configured media player from ctx", () => {
    expect(parseCommand("graj muzykę", { mediaPlayer: "media_player.sonos" })).toMatchObject({
      service: "media_play", data: { entity_id: "media_player.sonos" },
    })
  })

  it("controls named light fixtures", () => {
    expect(parseCommand("zapal lampkę nocną")).toMatchObject({
      domain: "input_boolean", service: "turn_on",
      data: { entity_id: "input_boolean.wirtualne_swiatlo_sypialnia_lampka" },
      key: "assistant.done.deviceOn", params: { fix: "nocna" },
    })
    expect(parseCommand("wyłącz kinkiet")).toMatchObject({
      service: "turn_off",
      data: { entity_id: "input_boolean.wirtualne_swiatlo_sypialnia_kinkiet" },
      params: { fix: "kinkiet" },
    })
  })
})

describe("disambiguate", () => {
  it("offers device choices for a bare on/off action", () => {
    const opts = disambiguate("włącz")
    const entities = opts.map((o) => o.data.entity_id)
    expect(opts.length).toBeGreaterThanOrEqual(2)
    expect(entities).toContain("input_boolean.wirtualny_bojler")
    expect(entities).toContain("input_boolean.wirtualne_swiatlo_salon_glowne")
    expect(opts.every((o) => o.service === "turn_on")).toBe(true)
  })

  it("respects direction (wyłącz → all turn_off)", () => {
    const opts = disambiguate("wyłącz")
    expect(opts.every((o) => o.service === "turn_off")).toBe(true)
  })

  it("offers inverter vs EV for an unscoped 'naładuj'", () => {
    const opts = disambiguate("naładuj")
    expect(opts).toHaveLength(2)
    expect(opts.map((o) => o.key)).toContain("assistant.done.inverterCharge")
    expect(opts.map((o) => o.key)).toContain("assistant.done.evLimit")
  })

  it("returns nothing when the phrase is unambiguous", () => {
    expect(disambiguate("włącz bojler")).toHaveLength(0)
    expect(disambiguate("opowiedz dowcip")).toHaveLength(0)
  })
})

describe("scenes", () => {
  it("expands 'dobranoc' into multiple commands", () => {
    const s = matchScene("dobranoc")
    expect(s?.key).toBe("assistant.scene.goodnight")
    const entities = s!.commands.map((c) => c.data.entity_id)
    expect(entities).toContain("input_boolean.wirtualne_swiatlo_salon_glowne")
    expect(entities).toContain("input_boolean.wirtualny_bojler")
  })

  it("'wychodzę' sets away presence and turns things off", () => {
    const s = matchScene("wychodzę")
    expect(s?.key).toBe("assistant.scene.away")
    expect(s!.commands.some((c) => c.data.option === "Poza domem")).toBe(true)
  })

  it("returns null for a non-scene phrase", () => {
    expect(matchScene("włącz bojler")).toBeNull()
  })

  it("turns off every room light via the all-lights scene", () => {
    const s = matchScene("zgaś wszystkie światła")
    expect(s?.key).toBe("assistant.scene.allLightsOff")
    expect(s!.commands).toHaveLength(5)
    expect(s!.commands.every((c) => c.service === "turn_off")).toBe(true)
  })

  it("'zapal wszystkie światła' turns them all on", () => {
    const s = matchScene("zapal wszystkie światła")
    expect(s?.key).toBe("assistant.scene.allLightsOn")
    expect(s!.commands.every((c) => c.service === "turn_on")).toBe(true)
  })
})

describe("resolveFollowUp", () => {
  it("re-targets the last toggled device on a bare on/off", () => {
    expect(resolveFollowUp("a teraz wyłącz", "boiler_on")).toMatchObject({
      service: "turn_off", data: { entity_id: "input_boolean.wirtualny_bojler" },
    })
  })

  it("repeats / flips temperature steps relative to the setpoint", () => {
    expect(resolveFollowUp("jeszcze cieplej", "temp_up", { salonTemp: 22 })).toMatchObject({
      key: "assistant.done.tempUp", data: { value: 23 },
    })
    expect(resolveFollowUp("trochę mniej", "temp_up", { salonTemp: 22 })).toMatchObject({
      key: "assistant.done.tempDown", data: { value: 21 },
    })
  })

  it("returns null without a prior intent or a usable anchor", () => {
    expect(resolveFollowUp("wyłącz", null)).toBeNull()
    expect(resolveFollowUp("hello there", "boiler_on")).toBeNull()
  })
})

it("attaches the resolved intent to a parsed command", () => {
  expect(parseCommand("włącz bojler")).toMatchObject({ intent: "boiler_on" })
})

describe("parseQuery", () => {
  it("recognises state questions", () => {
    expect(parseQuery("ile produkuje PV?")).toEqual({ intent: "query_pv" })
    expect(parseQuery("jaki jest stan baterii")).toEqual({ intent: "query_soc" })
    expect(parseQuery("ile dom pobiera teraz")).toEqual({ intent: "query_load" })
    expect(parseQuery("jaka cena prądu")).toEqual({ intent: "query_price" })
    expect(parseQuery("ile dziś wydałem")).toEqual({ intent: "query_cost" })
  })

  it("answers temperature questions with the room", () => {
    expect(parseQuery("jaka temperatura w kuchni")).toEqual({ intent: "query_temp", room: "kuchnia" })
    expect(parseQuery("ile stopni w sypialni")).toEqual({ intent: "query_temp", room: "sypialnia" })
  })

  it("does not treat commands as questions", () => {
    expect(parseQuery("ustaw temperaturę na 22")).toBeNull()
    expect(parseQuery("włącz bojler")).toBeNull()
  })
})
