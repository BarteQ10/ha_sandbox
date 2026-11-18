// The dashboard's navigation, as data.
//
// App.tsx renders its tab bars from this list and Settings builds its
// visibility switches from the same one, so the two cannot drift: a section
// added here appears in both, and one renamed in only one place does not exist.
//
// Most of what this dashboard shows is simulated. A house with a couple of real
// devices wants the rest out of the way, which is what the visibility
// preference and the presets below are for.
import {
  BarChart3,
  Bed,
  Bell,
  Bolt,
  CloudSun,
  Eye,
  FileText,
  FlaskConical,
  History,
  Home,
  Map,
  Music,
  Plug,
  ScrollText,
  Sofa,
  Sparkles,
  SlidersHorizontal,
  ToggleLeft,
  TreePine,
  Users,
  Video,
} from "lucide-react"
import type React from "react"

export interface SubSection {
  /** Sub-tab value, as the Tabs component uses it ("day"). */
  id: string
  /** Visibility key, namespaced because sub-tab ids repeat ("energy.energy"). */
  key: string
  labelKey: string
  icon: React.ElementType
}

export interface Section {
  /** Top-tab value, which doubles as its visibility key. */
  id: string
  labelKey: string
  icon: React.ElementType
  subs: SubSection[]
}

const sub = (
  parent: string,
  id: string,
  labelKey: string,
  icon: React.ElementType,
): SubSection => ({ id, key: `${parent}.${id}`, labelKey, icon })

export const SECTIONS: Section[] = [
  {
    id: "rooms",
    labelKey: "nav.rooms",
    icon: Home,
    subs: [
      sub("rooms", "plan", "nav.floorplan", Map),
      sub("rooms", "day", "rooms.day", Sofa),
      sub("rooms", "night", "rooms.night", Bed),
      sub("rooms", "garden", "rooms.gardenLabel", TreePine),
      sub("rooms", "media", "nav.media", Music),
      sub("rooms", "devices", "nav.devices", Plug),
    ],
  },
  {
    id: "energy",
    labelKey: "nav.energy",
    icon: Bolt,
    subs: [
      sub("energy", "flow", "nav.flow", Bolt),
      sub("energy", "energy", "nav.charts", BarChart3),
      sub("energy", "advisor", "nav.advisor", Sparkles),
      sub("energy", "controls", "nav.controls", ToggleLeft),
      sub("energy", "presence", "nav.presence", Users),
    ],
  },
  {
    id: "monitoring",
    labelKey: "nav.monitoring",
    icon: Eye,
    subs: [
      sub("monitoring", "cameras", "nav.cameras", Video),
      sub("monitoring", "events", "nav.events", ScrollText),
      sub("monitoring", "history", "nav.history", History),
      sub("monitoring", "alerts", "nav.alerts", Bell),
    ],
  },
  {
    id: "analytics",
    labelKey: "nav.analytics",
    icon: BarChart3,
    subs: [
      sub("analytics", "reports", "nav.reports", FileText),
      sub("analytics", "backtest", "nav.backtest", FlaskConical),
      sub("analytics", "weather", "nav.weather", CloudSun),
    ],
  },
  { id: "settings", labelKey: "nav.settings", icon: SlidersHorizontal, subs: [] },
]

/**
 * Settings can never be hidden — it is the only way back to these switches.
 * Every helper below treats it as visible whatever the stored preference says.
 */
export const LOCKED_SECTION = "settings"

/** Every visibility key there is, top-level sections and sub-sections alike. */
export const ALL_KEYS: string[] = SECTIONS.flatMap((s) => [s.id, ...s.subs.map((x) => x.key)])

/**
 * What a house with a couple of real devices keeps.
 *
 * A WLED light shows up in the room views and in the device list; a contact
 * sensor in the device list, the event log and the alerts. Everything else on
 * this dashboard is the simulator talking about a battery, an inverter and a
 * heat pump that are not there.
 */
export const REAL_HARDWARE_KEYS: string[] = [
  "rooms",
  "rooms.day",
  "rooms.devices",
  "monitoring",
  "monitoring.events",
  "monitoring.alerts",
  LOCKED_SECTION,
]

export type Preset = "all" | "real"

/** The hidden-key list a preset corresponds to. */
export function hiddenForPreset(preset: Preset): string[] {
  if (preset === "all") return []
  return ALL_KEYS.filter((key) => !REAL_HARDWARE_KEYS.includes(key))
}

/**
 * Whether `key` should be rendered, given the stored hidden list.
 *
 * Absence means visible, deliberately: the preference stores what to HIDE, so a
 * section added in a later release shows up for someone who already has a saved
 * preference instead of being invisible until they go looking for it.
 */
export function isSectionVisible(hidden: readonly string[], key: string): boolean {
  if (key === LOCKED_SECTION) return true
  return !hidden.includes(key)
}

/** Toggling one key, returning the new hidden list. */
export function toggleKey(hidden: readonly string[], key: string): string[] {
  if (key === LOCKED_SECTION) return [...hidden]
  return hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key]
}

/**
 * The tab to land on when the stored one is hidden.
 *
 * Without this, hiding the section you are currently looking at leaves a blank
 * page with no active tab. Settings is the last resort because it cannot be
 * hidden.
 */
export function firstVisibleSection(hidden: readonly string[]): string {
  const found = SECTIONS.find((s) => isSectionVisible(hidden, s.id))
  return found ? found.id : LOCKED_SECTION
}

/**
 * Whether a visible section still has anything behind it.
 *
 * Turning off every sub-tab of a section leaves a tab that opens an empty
 * sub-nav, so the nav treats that as hidden too.
 */
export function sectionHasContent(hidden: readonly string[], sectionId: string): boolean {
  const section = SECTIONS.find((s) => s.id === sectionId)
  if (!section) return false
  if (section.subs.length === 0) return true
  return section.subs.some((x) => isSectionVisible(hidden, x.key))
}

/** The same, for the sub-tabs of one section; null when it has none visible. */
export function firstVisibleSub(hidden: readonly string[], sectionId: string): string | null {
  const section = SECTIONS.find((s) => s.id === sectionId)
  const found = section?.subs.find((x) => isSectionVisible(hidden, x.key))
  return found ? found.id : null
}
