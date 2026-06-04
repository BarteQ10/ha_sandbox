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
  /** The intent that produced this command — used for follow-up context. */
  intent?: string
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
  | "set_temp" | "temp_up" | "temp_down"

/** Live state the mapping may need (e.g. current setpoint for relative temp). */
export interface AssistantCtx {
  salonTemp?: number
}

const EV_MAX = 7400
const TEMP_MIN = 16
const TEMP_MAX = 30
const TEMP_DEFAULT = 21
const TEMP_ENTITY = "input_number.wirtualne_ustawienie_temp_salon"

const clampTemp = (v: number) => Math.max(TEMP_MIN, Math.min(TEMP_MAX, Math.round(v * 2) / 2))

function setTemp(value: number, key: string): ParsedCommand {
  const v = clampTemp(value)
  return {
    domain: "input_number", service: "set_value",
    data: { entity_id: TEMP_ENTITY, value: v },
    key, params: { t: v },
  }
}

/** Map a validated intent (+ value, + live ctx) to a HA service call. */
export function intentToCommand(
  intent: string,
  value?: number | null,
  ctx?: AssistantCtx,
): ParsedCommand | null {
  const cmd = buildCommand(intent, value, ctx)
  return cmd ? { ...cmd, intent } : null
}

function buildCommand(
  intent: string,
  value?: number | null,
  ctx?: AssistantCtx,
): ParsedCommand | null {
  const curTemp = ctx?.salonTemp ?? TEMP_DEFAULT
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
    case "set_temp":  return setTemp(value ?? TEMP_DEFAULT, "assistant.done.setTemp")
    case "temp_up":   return setTemp(curTemp + 1, "assistant.done.tempUp")
    case "temp_down": return setTemp(curTemp - 1, "assistant.done.tempDown")
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
export function parseCommand(raw: string, ctx?: AssistantCtx): ParseResult {
  const t = norm(raw)
  if (!t) return null

  // ── Temperature (salon setpoint): absolute "ustaw temp na 22" or relative.
  // Note: "grzej" is intentionally NOT a trigger — "podgrzej wodę" is a boiler
  // command, not a thermostat one (handled below / by the LLM). ──
  if (/(temperatur|cieplej|chlodniej|zimniej)/.test(t)) {
    const m = t.match(/(\d{1,2})/)
    if (m && /(ustaw|na |=|do )/.test(t)) return intentToCommand("set_temp", parseInt(m[1], 10), ctx)
    if (/(zwieksz|podnies|wyzej|wyzsz|cieplej|wiecej)/.test(t)) return intentToCommand("temp_up", null, ctx)
    if (/(zmniejsz|obniz|nizej|nizsz|chlodniej|zimniej|mniej)/.test(t)) return intentToCommand("temp_down", null, ctx)
  }

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

const DEVICE_WORDS =
  /(boiler|bojler|light|swiatl|lamp|storm|sztorm|burz|inverter|inwerter|falownik|ev|samochod|car|elektryk|ladowark|presence|obecnosc|w domu|urlop|temperatur|cieplej|chlodniej|zimniej)/

/**
 * When a phrase is under-specified — an action with no clear target — return the
 * plausible commands so the UI can ask the user to pick one. Empty array when the
 * phrase is unambiguous (parseCommand should handle it) or not an action at all.
 */
export function disambiguate(raw: string, ctx?: AssistantCtx): ParsedCommand[] {
  const t = norm(raw)
  if (!t) return []
  const keep = (xs: (ParsedCommand | null)[]) => xs.filter((c): c is ParsedCommand => c !== null)

  // Bare on/off with no device named → which device?
  const dir = onOff(t)
  if (dir && !DEVICE_WORDS.test(t)) {
    const on = dir === "on"
    return keep([
      intentToCommand(on ? "boiler_on" : "boiler_off"),
      intentToCommand(on ? "light_on" : "light_off"),
      intentToCommand(on ? "storm_on" : "storm_off", null, ctx),
    ])
  }

  // "charge / ładuj" with neither an inverter nor a numeric EV target → which charge?
  if (/(naladuj|ladowanie|laduj|charge)/.test(t)
      && !/(inverter|inwerter|falownik)/.test(t) && !/\d/.test(t)) {
    return keep([
      intentToCommand("inverter_charge"),
      intentToCommand("set_ev", EV_MAX),
    ])
  }

  return []
}

// ── Scenes: one phrase → several actions ───────────────────────────────────────
interface SceneDef { match: RegExp; key: string; steps: { intent: Intent; value?: number }[] }

const SCENES: SceneDef[] = [
  {
    match: /(dobranoc|good ?night|ide spac|idziemy spac)/,
    key: "assistant.scene.goodnight",
    steps: [{ intent: "light_off" }, { intent: "boiler_off" }, { intent: "inverter_auto" }],
  },
  {
    match: /(dzien dobry|good morning|pobudka|wstaje)/,
    key: "assistant.scene.morning",
    steps: [{ intent: "light_on" }, { intent: "set_temp", value: 21 }],
  },
  {
    match: /(wychodze|opuszczam dom|i'?m leaving|leaving home)/,
    key: "assistant.scene.away",
    steps: [{ intent: "presence_away" }, { intent: "light_off" }, { intent: "boiler_off" }],
  },
  {
    match: /(wracam do domu|wrocilem|i'?m home|arrived home)/,
    key: "assistant.scene.home",
    steps: [{ intent: "presence_home" }, { intent: "light_on" }],
  },
]

/** Match a multi-action scene phrase. Checked before the single-command parser. */
export function matchScene(raw: string, ctx?: AssistantCtx): { key: string; commands: ParsedCommand[] } | null {
  const t = norm(raw)
  if (!t) return null
  for (const s of SCENES) {
    if (!s.match.test(t)) continue
    const commands = s.steps
      .map((step) => intentToCommand(step.intent, step.value ?? null, ctx))
      .filter((c): c is ParsedCommand => c !== null)
    if (commands.length) return { key: s.key, commands }
  }
  return null
}

// ── Follow-up context: resolve a short reply against the previous command ───────
/**
 * Resolve a contextual follow-up ("a teraz wyłącz", "jeszcze cieplej") against
 * the last executed intent. Returns null when there's nothing to anchor to.
 */
export function resolveFollowUp(
  raw: string,
  lastIntent: string | null | undefined,
  ctx?: AssistantCtx,
): ParsedCommand | null {
  if (!lastIntent) return null
  const t = norm(raw)
  if (!t) return null

  // 1) Bare on/off with no device named → re-target the last toggled device.
  const dir = onOff(t)
  if (dir && !DEVICE_WORDS.test(t)) {
    const m = lastIntent.match(/^(boiler|light|storm)_(on|off)$/)
    if (m) return intentToCommand(`${m[1]}_${dir === "on" ? "on" : "off"}`, null, ctx)
  }

  // 2) "more / again" after a temperature command → step in the same (or named) dir.
  const lastWasTemp = lastIntent === "temp_up" || lastIntent === "temp_down" || lastIntent === "set_temp"
  if (lastWasTemp && /(jeszcze|bardziej|wiecej|troche|mniej|znowu|jeszcze raz|a bit|more|again)/.test(t)) {
    const down = /(mniej|nizej|chlodniej|zimniej|slabiej|less|down)/.test(t)
    const up = /(wiecej|bardziej|cieplej|wyzej|more|up)/.test(t)
    const dirTemp = down ? "temp_down" : up ? "temp_up" : lastIntent === "temp_down" ? "temp_down" : "temp_up"
    return intentToCommand(dirTemp, null, ctx)
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
