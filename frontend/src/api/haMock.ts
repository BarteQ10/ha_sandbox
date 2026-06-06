// Offline mock of the Home Assistant backend, used for E2E (Playwright) and
// local UI work without a running HA. Activated by VITE_HA_MOCK=1 (see
// .env.e2e). haClient.ts seeds the store from MOCK_ENTITIES instead of opening
// a WebSocket, and routes service calls through applyMockService so toggles and
// sliders reflect optimistically. This file is tree-shaken out of normal builds.
import type { HassEntities, HassEntity } from "home-assistant-js-websocket"

const TS = "2024-01-01T00:00:00.000Z"

function ent(
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntity {
  return {
    entity_id,
    state,
    attributes,
    last_changed: TS,
    last_updated: TS,
    context: { id: "mock", parent_id: null, user_id: null },
  }
}

// A representative slice of the simulator's entities — enough for every section
// to render with real-looking values. Components fall back gracefully for any
// entity not listed here, so this does not need to be exhaustive.
const _LIST: HassEntity[] = [
  // Core energy telemetry
  ent("sensor.sztuczna_produkcja_pv", "2450", { unit_of_measurement: "W", friendly_name: "PV Production" }),
  ent("sensor.sztuczny_stan_baterii_soc", "73", { unit_of_measurement: "%", friendly_name: "Battery SoC" }),
  ent("sensor.ems_pobor_domu_bazowy", "1820", { unit_of_measurement: "W", friendly_name: "House Load" }),
  ent("sensor.ems_biezaca_cena_energii", "42", { unit_of_measurement: "gr/kWh", friendly_name: "Energy Price" }),
  ent("sensor.ems_moc_netto_bilans", "630", { unit_of_measurement: "W", friendly_name: "Net Balance" }),
  ent("sensor.ems_szczyt_cena_dzis", "68", { unit_of_measurement: "gr/kWh" }),
  ent("sensor.ems_bilans_finansowy_dzis", "-3.42", { unit_of_measurement: "PLN" }),

  // Lighting (Salon) — auto-discovered light.* entities
  ent("light.salon_lampa_stojaca", "on", {
    brightness: 200, color_temp_kelvin: 3000, friendly_name: "Lampa stojąca",
    supported_color_modes: ["color_temp"],
  }),
  ent("light.salon_led", "off", { friendly_name: "Salon LED", supported_color_modes: ["rgb"] }),

  // Room-card light/temperature entities (input_*) used by the Home → rooms view
  ent("input_boolean.wirtualne_swiatlo_salon_glowne", "off", { friendly_name: "Salon Main Light" }),
  ent("input_boolean.wirtualne_swiatlo_kuchnia_glowne", "off", { friendly_name: "Kitchen Main Light" }),
  ent("input_boolean.wirtualne_swiatlo_sypialnia_glowne", "off", { friendly_name: "Bedroom Main Light" }),
  // Named fixtures (sub-lights)
  ent("input_boolean.wirtualne_swiatlo_sypialnia_lampka", "off", { friendly_name: "Night Lamp" }),
  ent("input_boolean.wirtualne_swiatlo_salon_lampa", "off", { friendly_name: "Floor Lamp" }),
  ent("input_boolean.wirtualne_swiatlo_sypialnia_kinkiet", "off", { friendly_name: "Wall Light" }),
  ent("input_boolean.wirtualne_swiatlo_lazienka_lustro", "off", { friendly_name: "Mirror Light" }),
  ent("input_boolean.wirtualne_swiatlo_kuchnia_wyspa", "off", { friendly_name: "Island Light" }),
  ent("input_number.wirtualna_temp_salon", "21.5", { unit_of_measurement: "°C" }),
  ent("input_number.wirtualna_temp_kuchnia", "20.5", { unit_of_measurement: "°C" }),
  ent("input_number.wirtualna_temp_sypialnia", "19.0", { unit_of_measurement: "°C" }),
  ent("input_number.wirtualne_ustawienie_temp_salon", "21", { min: 16, max: 30, step: 0.5 }),
  ent("input_number.wirtualne_ustawienie_temp_kuchnia", "20", { min: 16, max: 30, step: 0.5 }),
  ent("input_number.wirtualne_ustawienie_temp_sypialnia", "19", { min: 16, max: 30, step: 0.5 }),
  // Motorised blinds (0–100 position)
  ent("input_number.wirtualne_rolety_salon", "100", { min: 0, max: 100, step: 1 }),
  ent("input_number.wirtualne_rolety_kuchnia", "100", { min: 0, max: 100, step: 1 }),
  ent("input_number.wirtualne_rolety_sypialnia", "100", { min: 0, max: 100, step: 1 }),
  ent("input_number.wirtualne_rolety_lazienka", "100", { min: 0, max: 100, step: 1 }),

  // Climate + cover
  // The entity id must match what the room cards (Rooms.tsx) and HA's MQTT
  // discovery use, and friendly_name must be set — otherwise the card falls back
  // to rendering the raw entity id ("climate.ems_simulator_living_room_trv").
  ent("climate.ems_simulator_living_room_trv", "heat", {
    temperature: 21, current_temperature: 20.5, min_temp: 7, max_temp: 30,
    friendly_name: "EMS Simulator Living Room TRV",
  }),
  ent("cover.salon_rolety", "open", { current_position: 80, friendly_name: "Salon Blinds" }),

  // Contact sensors referenced by the Wspólne room cards (Rooms.tsx).
  ent("binary_sensor.ems_simulator_living_window", "off", {
    device_class: "window", friendly_name: "EMS Simulator Living Window",
  }),
  ent("binary_sensor.ems_simulator_kitchen_leak", "off", {
    device_class: "moisture", friendly_name: "EMS Simulator Kitchen Leak",
  }),

  // EMS controls
  ent("input_boolean.wirtualny_bojler", "off", { friendly_name: "Boiler" }),
  ent("input_boolean.ems_storm_safeguard", "off", { friendly_name: "Storm Safeguard" }),
  ent("input_select.ems_tryb_inwertera", "Auto", {
    options: ["Auto", "Force Charge", "Force Discharge"], friendly_name: "Inverter Mode",
  }),
  ent("input_select.ems_tryb_obecnosci", "W domu", {
    options: ["W domu", "Poza domem", "Urlop"], friendly_name: "Presence Mode",
  }),
  ent("input_number.ems_limit_ladowania_ev", "3700", {
    min: 0, max: 7400, step: 100, friendly_name: "EV Charge Limit",
  }),
  ent("input_select.ems_tryb_pompy_ciepla", "Wylaczona", {
    options: ["Wylaczona", "Komfort", "Boost"], friendly_name: "Heat Pump Mode",
  }),
  ent("input_select.ems_status_sieci", "Normal", {
    options: ["Normal", "Blackout", "Fluktuacje"], friendly_name: "Grid Status",
  }),
  ent("input_boolean.ems_v2g_mode", "off", { friendly_name: "V2G Mode" }),
  ent("input_boolean.ems_ev_override", "off", { friendly_name: "EV Override" }),
  ent("switch.ems_ograniczenie_pv", "off", { friendly_name: "PV Curtailment" }),

  // Auto-discovered media player + camera (for the Media / Cameras views)
  ent("media_player.salon", "playing", {
    friendly_name: "Salon Speaker",
    media_title: "Mock Track",
    media_artist: "Mock Artist",
    volume_level: 0.4,
    supported_features: 0,
  }),
  ent("camera.ogrod", "streaming", {
    friendly_name: "Garden Cam",
    entity_picture: "/api/camera_proxy/camera.ogrod",
  }),
]

export const MOCK_ENTITIES: HassEntities = Object.fromEntries(
  _LIST.map((e) => [e.entity_id, e]),
)

/**
 * Apply a service call to the mock store optimistically, so the UI reflects
 * interactions during E2E. Handles the common domains the dashboard uses;
 * unknown services are a no-op.
 */
export function applyMockService(
  _domain: string,
  service: string,
  data: Record<string, unknown>,
  entities: HassEntities,
  setEntities: (e: HassEntities) => void,
): void {
  const raw = data.entity_id
  const ids = Array.isArray(raw) ? (raw as string[]) : raw ? [String(raw)] : []
  if (!ids.length) return

  const next: HassEntities = { ...entities }
  for (const id of ids) {
    const cur = next[id]
    if (!cur) continue
    let state = cur.state
    const attributes = { ...cur.attributes }

    if (service === "turn_on") state = "on"
    else if (service === "turn_off") state = "off"
    else if (service === "toggle") state = cur.state === "on" ? "off" : "on"
    else if (service === "select_option" && data.option != null) state = String(data.option)
    else if (service === "set_value" && data.value != null) state = String(data.value)
    else if (service === "set_temperature" && data.temperature != null) {
      attributes.temperature = data.temperature
    }

    next[id] = { ...cur, state, attributes, last_updated: new Date().toISOString() }
  }
  setEntities(next)
}
