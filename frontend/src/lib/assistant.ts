// Local natural-language intent parser (9.E). Maps free-text commands (Polish
// or English) to Home Assistant service calls — no LLM, no API keys, fully
// offline and unit-testable. The Assistant component calls parseCommand() and
// dispatches the returned service call, then shows the localised confirmation.

export interface ParsedCommand {
  domain: string
  service: string
  data: Record<string, unknown>
  /** i18n key for the confirmation message (e.g. "assistant.done.boilerOn"). */
  key: string
  params?: Record<string, unknown>
}

export type ParseResult = ParsedCommand | null

// Normalise: lowercase + strip Polish diacritics so patterns stay ASCII.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/ł/g, "l")         // ł → l (not a combining mark)
    .trim()
}

const ON = /\b(on|enable|start|wlacz|zalacz|aktywuj)\b/
const OFF = /\b(off|disable|stop|wylacz|deaktywuj|dezaktywuj)\b/

function onOff(text: string): "on" | "off" | null {
  if (OFF.test(text)) return "off"
  if (ON.test(text)) return "on"
  return null
}

/**
 * Parse a single natural-language command. Returns a service-call descriptor +
 * confirmation key, or null when nothing matched. Order matters: more specific
 * intents are checked before generic on/off devices.
 */
export function parseCommand(raw: string): ParseResult {
  const t = norm(raw)
  if (!t) return null

  // ── Storm safeguard ──
  if (/(storm|sztorm|burz)/.test(t)) {
    const s = onOff(t) ?? "on"
    return {
      domain: "input_boolean",
      service: s === "on" ? "turn_on" : "turn_off",
      data: { entity_id: "input_boolean.ems_storm_safeguard" },
      key: s === "on" ? "assistant.done.stormOn" : "assistant.done.stormOff",
    }
  }

  // ── Inverter mode (discharge before charge — "rozladuj" contains "laduj") ──
  if (/(inverter|inwerter|falownik)/.test(t)) {
    if (/(discharge|rozladuj|rozladow)/.test(t)) {
      return invSel("Force Discharge", "assistant.done.inverterDischarge")
    }
    if (/(charge|laduj|ladow)/.test(t)) {
      return invSel("Force Charge", "assistant.done.inverterCharge")
    }
    if (/\bauto\b/.test(t)) {
      return invSel("Auto", "assistant.done.inverterAuto")
    }
  }

  // ── Presence ──
  if (/(away|poza dom|wyjazd|wyjezdzam|wychodze)/.test(t)) {
    return presSel("Poza domem", "assistant.done.presenceAway")
  }
  if (/(vacation|urlop|wakacj)/.test(t)) {
    return presSel("Urlop", "assistant.done.presenceVacation")
  }
  if (/(w domu|jestem w domu|wracam|i'?m home|at home)/.test(t)) {
    return presSel("W domu", "assistant.done.presenceHome")
  }

  // ── EV charge limit: "set EV to 5000", "limit ladowania ev 6000" ──
  if (/(ev|samochod|car|elektryk|ladowark)/.test(t)) {
    const m = t.match(/(\d{2,5})/)
    if (m) {
      const w = Math.max(0, Math.min(7400, parseInt(m[1], 10)))
      return {
        domain: "input_number",
        service: "set_value",
        data: { entity_id: "input_number.ems_limit_ladowania_ev", value: w },
        key: "assistant.done.evLimit",
        params: { w },
      }
    }
  }

  // ── Boiler ──
  if (/(boiler|bojler)/.test(t)) {
    const s = onOff(t) ?? "on"
    return {
      domain: "input_boolean",
      service: s === "on" ? "turn_on" : "turn_off",
      data: { entity_id: "input_boolean.wirtualny_bojler" },
      key: s === "on" ? "assistant.done.boilerOn" : "assistant.done.boilerOff",
    }
  }

  // ── Living-room light ──
  if (/(light|swiatl|lamp)/.test(t)) {
    const s = onOff(t) ?? "on"
    return {
      domain: "input_boolean",
      service: s === "on" ? "turn_on" : "turn_off",
      data: { entity_id: "input_boolean.wirtualne_swiatlo_salon_glowne" },
      key: s === "on" ? "assistant.done.lightOn" : "assistant.done.lightOff",
    }
  }

  return null
}

function invSel(option: string, key: string): ParsedCommand {
  return {
    domain: "input_select",
    service: "select_option",
    data: { entity_id: "input_select.ems_tryb_inwertera", option },
    key,
  }
}

function presSel(option: string, key: string): ParsedCommand {
  return {
    domain: "input_select",
    service: "select_option",
    data: { entity_id: "input_select.ems_tryb_obecnosci", option },
    key,
  }
}
