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

// The fixed action vocabulary, shared by the regex parser (layer 1) and the
// local-LLM classifier (layer 2, backend assistant_llm.py). Both produce an
// intent string + optional value; intentToCommand() is the single place that
// maps an intent to a concrete HA service call.
export type Intent =
  | "boiler_on" | "boiler_off"
  | "light_on" | "light_off"
  | "inverter_auto" | "inverter_charge" | "inverter_discharge"
  | "presence_home" | "presence_away" | "presence_vacation"
  | "storm_on" | "storm_off"
  | "set_ev"

const EV_MAX = 7400

/** Map a validated intent (+ value for set_ev) to a HA service call. */
export function intentToCommand(intent: string, value?: number | null): ParsedCommand | null {
  switch (intent) {
    case "boiler_on":  return bool("input_boolean.wirtualny_bojler", true, "assistant.done.boilerOn")
    case "boiler_off": return bool("input_boolean.wirtualny_bojler", false, "assistant.done.boilerOff")
    case "light_on":   return bool("input_boolean.wirtualne_swiatlo_salon_glowne", true, "assistant.done.lightOn")
    case "light_off":  return bool("input_boolean.wirtualne_swiatlo_salon_glowne", false, "assistant.done.lightOff")
    case "storm_on":   return bool("input_boolean.ems_storm_safeguard", true, "assistant.done.stormOn")
    case "storm_off":  return bool("input_boolean.ems_storm_safeguard", false, "assistant.done.stormOff")
    case "inverter_auto":      return invSel("Auto", "assistant.done.inverterAuto")
    case "inverter_charge":    return invSel("Force Charge", "assistant.done.inverterCharge")
    case "inverter_discharge": return invSel("Force Discharge", "assistant.done.inverterDischarge")
    case "presence_home":     return presSel("W domu", "assistant.done.presenceHome")
    case "presence_away":     return presSel("Poza domem", "assistant.done.presenceAway")
    case "presence_vacation": return presSel("Urlop", "assistant.done.presenceVacation")
    case "set_ev": {
      const w = Math.max(0, Math.min(EV_MAX, Math.round(value ?? 0)))
      return {
        domain: "input_number", service: "set_value",
        data: { entity_id: "input_number.ems_limit_ladowania_ev", value: w },
        key: "assistant.done.evLimit", params: { w },
      }
    }
    default: return null
  }
}

function bool(entity_id: string, on: boolean, key: string): ParsedCommand {
  return { domain: "input_boolean", service: on ? "turn_on" : "turn_off", data: { entity_id }, key }
}

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
    return intentToCommand((onOff(t) ?? "on") === "on" ? "storm_on" : "storm_off")
  }

  // ── Inverter mode (discharge before charge — "rozladuj" contains "laduj") ──
  if (/(inverter|inwerter|falownik)/.test(t)) {
    if (/(discharge|rozladuj|rozladow)/.test(t)) return intentToCommand("inverter_discharge")
    if (/(charge|laduj|ladow)/.test(t))          return intentToCommand("inverter_charge")
    if (/\bauto\b/.test(t))                       return intentToCommand("inverter_auto")
  }

  // ── Presence ──
  if (/(away|poza dom|wyjazd|wyjezdzam|wychodze)/.test(t)) return intentToCommand("presence_away")
  if (/(vacation|urlop|wakacj)/.test(t))                   return intentToCommand("presence_vacation")
  if (/(w domu|jestem w domu|wracam|i'?m home|at home)/.test(t)) return intentToCommand("presence_home")

  // ── EV charge limit: "set EV to 5000", "limit ladowania ev 6000" ──
  if (/(ev|samochod|car|elektryk|ladowark)/.test(t)) {
    const m = t.match(/(\d{2,5})/)
    if (m) return intentToCommand("set_ev", parseInt(m[1], 10))
  }

  // ── Boiler ──
  if (/(boiler|bojler)/.test(t)) {
    return intentToCommand((onOff(t) ?? "on") === "on" ? "boiler_on" : "boiler_off")
  }

  // ── Living-room light ──
  if (/(light|swiatl|lamp)/.test(t)) {
    return intentToCommand((onOff(t) ?? "on") === "on" ? "light_on" : "light_off")
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
