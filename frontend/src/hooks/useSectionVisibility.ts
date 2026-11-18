import { useCallback, useSyncExternalStore } from "react"
import {
  hiddenForPreset,
  isSectionVisible,
  toggleKey,
  type Preset,
} from "@/lib/sections"

const STORAGE_KEY = "ems.hiddenSections"

/**
 * Which dashboard sections this browser hides.
 *
 * Module-level rather than per-component state, and read through
 * useSyncExternalStore the way api/haClient keeps entities: Settings renders
 * the switches while App renders the tabs, and with a useState each they held
 * two independent copies — flipping a switch left the navigation untouched
 * until a reload.
 *
 * The list stored is what to HIDE rather than what to show, so a section added
 * in a later release is visible to someone who already saved a preference.
 * Every read and write is guarded: localStorage throws in a private window and
 * can come back empty after site data is cleared, and a dashboard that renders
 * nothing would be a poor trade for a remembered checkbox.
 */
function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []
  } catch {
    return []
  }
}

let hidden: string[] = load()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Returns the same reference until something actually changes, which is what
// useSyncExternalStore needs to avoid re-rendering on every check.
function getSnapshot(): string[] {
  return hidden
}

function publish(next: string[]): void {
  hidden = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* private mode / quota — the preference is a convenience, not state */
  }
  for (const listener of listeners) listener()
}

/** Reset the store and the stored preference (used in tests). */
export function resetSectionVisibility(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to clear */
  }
  publish([])
}

export function useSectionVisibility() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const isVisible = useCallback((key: string) => isSectionVisible(current, key), [current])
  const toggle = useCallback((key: string) => publish(toggleKey(hidden, key)), [])
  const applyPreset = useCallback((preset: Preset) => publish(hiddenForPreset(preset)), [])

  return { hidden: current, isVisible, toggle, applyPreset }
}
