import { describe, it, expect, beforeEach, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  ALL_KEYS,
  LOCKED_SECTION,
  REAL_HARDWARE_KEYS,
  SECTIONS,
  firstVisibleSection,
  firstVisibleSub,
  hiddenForPreset,
  isSectionVisible,
  sectionHasContent,
  toggleKey,
} from "@/lib/sections"
import { resetSectionVisibility, useSectionVisibility } from "@/hooks/useSectionVisibility"

// ── the registry itself ──────────────────────────────────────────────────────

describe("the section registry", () => {
  it("gives every section and sub-section a unique key", () => {
    // Sub-tab ids repeat across sections — "energy" is both a top tab and a
    // sub-tab of itself — so the keys have to be namespaced or two unrelated
    // switches would share one preference.
    expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length)
  })

  it("namespaces every sub-section key under its section", () => {
    for (const section of SECTIONS) {
      for (const item of section.subs) {
        expect(item.key).toBe(`${section.id}.${item.id}`)
      }
    }
  })

  it("keeps Settings in the registry, since that is where the switches live", () => {
    expect(SECTIONS.map((s) => s.id)).toContain(LOCKED_SECTION)
  })
})

// ── visibility ───────────────────────────────────────────────────────────────

describe("isSectionVisible", () => {
  it("treats an unknown key as visible", () => {
    // The preference stores what to HIDE, so a section added in a later
    // release shows up for someone who already saved one.
    expect(isSectionVisible(["energy"], "a.section.added.later")).toBe(true)
  })

  it("hides what the list names", () => {
    expect(isSectionVisible(["energy"], "energy")).toBe(false)
  })

  it("never hides Settings, whatever the list says", () => {
    expect(isSectionVisible([LOCKED_SECTION], LOCKED_SECTION)).toBe(true)
  })
})

describe("toggleKey", () => {
  it("hides then shows again", () => {
    const once = toggleKey([], "energy")
    expect(once).toEqual(["energy"])
    expect(toggleKey(once, "energy")).toEqual([])
  })

  it("refuses to hide Settings", () => {
    expect(toggleKey([], LOCKED_SECTION)).toEqual([])
  })

  it("does not mutate the list it is given", () => {
    const before: string[] = []
    toggleKey(before, "energy")
    expect(before).toEqual([])
  })
})

// ── presets ──────────────────────────────────────────────────────────────────

describe("hiddenForPreset", () => {
  it("hides nothing for the full simulator", () => {
    expect(hiddenForPreset("all")).toEqual([])
  })

  it("keeps exactly the real-hardware sections", () => {
    const hidden = hiddenForPreset("real")
    for (const key of REAL_HARDWARE_KEYS) {
      expect(isSectionVisible(hidden, key)).toBe(true)
    }
    // A WLED light and a contact sensor live in the device list, the event log
    // and the alerts; the battery/inverter/heat-pump panels do not apply.
    expect(isSectionVisible(hidden, "rooms.devices")).toBe(true)
    expect(isSectionVisible(hidden, "monitoring.alerts")).toBe(true)
    expect(isSectionVisible(hidden, "energy")).toBe(false)
    expect(isSectionVisible(hidden, "analytics")).toBe(false)
    expect(isSectionVisible(hidden, "rooms.media")).toBe(false)
  })

  it("leaves Settings reachable, or there would be no way back", () => {
    expect(isSectionVisible(hiddenForPreset("real"), LOCKED_SECTION)).toBe(true)
  })
})

// ── falling back when the open section disappears ────────────────────────────

describe("firstVisibleSection", () => {
  it("returns the first section that is still shown", () => {
    expect(firstVisibleSection(["rooms"])).toBe("energy")
  })

  it("falls back to Settings when everything else is hidden", () => {
    expect(firstVisibleSection(ALL_KEYS)).toBe(LOCKED_SECTION)
  })
})

describe("firstVisibleSub", () => {
  it("returns the first sub-tab still shown", () => {
    expect(firstVisibleSub(["rooms.plan"], "rooms")).toBe("day")
  })

  it("returns null when a section has no sub-tab left", () => {
    expect(firstVisibleSub(ALL_KEYS, "rooms")).toBeNull()
  })
})

describe("sectionHasContent", () => {
  it("is false once every sub-tab of a section is off", () => {
    // Such a tab would open an empty sub-nav, so the nav drops it.
    expect(sectionHasContent(ALL_KEYS, "energy")).toBe(false)
  })

  it("is true for a section with one sub-tab left", () => {
    expect(sectionHasContent(["energy.flow", "energy.energy"], "energy")).toBe(true)
  })

  it("is true for Settings, which has no sub-tabs at all", () => {
    expect(sectionHasContent(ALL_KEYS, LOCKED_SECTION)).toBe(true)
  })
})

// ── the hook's persistence ───────────────────────────────────────────────────

describe("useSectionVisibility", () => {
  beforeEach(() => {
    resetSectionVisibility()
  })

  it("starts with everything visible", () => {
    const { result } = renderHook(() => useSectionVisibility())
    expect(result.current.hidden).toEqual([])
    expect(result.current.isVisible("energy")).toBe(true)
  })

  it("shows one component's change to another", () => {
    // The regression. Settings renders the switches and App renders the tabs,
    // and with a useState each they held two independent copies: flipping a
    // switch left the navigation untouched until a reload.
    const settings = renderHook(() => useSectionVisibility())
    const nav = renderHook(() => useSectionVisibility())

    act(() => settings.result.current.toggle("energy"))

    expect(nav.result.current.isVisible("energy")).toBe(false)
  })

  it("writes the hidden list to storage so it survives a reload", () => {
    const { result } = renderHook(() => useSectionVisibility())
    act(() => result.current.toggle("energy"))

    expect(JSON.parse(localStorage.getItem("ems.hiddenSections") ?? "[]")).toEqual(["energy"])
  })

  it("applies a preset", () => {
    const { result } = renderHook(() => useSectionVisibility())
    act(() => result.current.applyPreset("real"))

    expect(result.current.isVisible("rooms.devices")).toBe(true)
    expect(result.current.isVisible("energy")).toBe(false)

    act(() => result.current.applyPreset("all"))
    expect(result.current.isVisible("energy")).toBe(true)
  })

  it("ignores junk in storage rather than rendering nothing", async () => {
    // The stored value is only read when the module first loads, so the module
    // has to be loaded again to exercise that path.
    localStorage.setItem("ems.hiddenSections", "{not json")
    vi.resetModules()
    const fresh = await import("@/hooks/useSectionVisibility")

    const { result } = renderHook(() => fresh.useSectionVisibility())
    expect(result.current.hidden).toEqual([])
  })

  it("ignores a stored value of the wrong shape", async () => {
    localStorage.setItem("ems.hiddenSections", '{"energy":true}')
    vi.resetModules()
    const fresh = await import("@/hooks/useSectionVisibility")

    const { result } = renderHook(() => fresh.useSectionVisibility())
    expect(result.current.hidden).toEqual([])
  })
})
