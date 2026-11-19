import { useCallback, useSyncExternalStore } from "react"
import {
  defaultHidden,
  hiddenForPreset,
  isSectionVisible,
  toggleKey,
  type Preset,
} from "@/lib/sections"

// Deliberately not the key the first version of this used. That one stored an
// empty list the moment the app mounted, so "never chose anything" and "chose
// to see everything" were written identically — and a browser carrying the old
// value would never pick up the new default. A fresh key makes the rollout
// unambiguous at the cost of discarding a preference this feature is hours old
// enough not to have accumulated.
const STORAGE_KEY = "ems.sections.v2"

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
    if (!raw) return defaultHidden()
    const parsed: unknown = JSON.parse(raw)
    // A stored choice wins, including the empty one: someone who switched
    // everything back on means it, and must not be overruled on every reload.
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === "string")
      : defaultHidden()
  } catch {
    return defaultHidden()
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
  hidden = defaultHidden()
  for (const listener of listeners) listener()
}

export function useSectionVisibility() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const isVisible = useCallback((key: string) => isSectionVisible(current, key), [current])
  const toggle = useCallback((key: string) => publish(toggleKey(hidden, key)), [])
  const applyPreset = useCallback((preset: Preset) => publish(hiddenForPreset(preset)), [])

  return { hidden: current, isVisible, toggle, applyPreset }
}
