import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockCallService = vi.fn()
const mockUseEntityNum = vi.fn()
const mockUseEntityState = vi.fn()

vi.mock("@/hooks/useHA", () => ({
  useEntityNum:   (id: string, def = 0) => mockUseEntityNum(id, def),
  useEntityState: (id: string, def = "") => mockUseEntityState(id, def),
  useHA:          () => ({ callService: mockCallService }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "en" },
  }),
}))

// MiniChart fetches HA history — stub it so tests stay synchronous/offline
vi.mock("@/components/charts/MiniChart", () => ({
  MiniChart: () => null,
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function setupEntities({
  presenceMode  = 0,
  presenceStr   = "W domu",
  brightness    = 80,
  colorTempK    = 4000,
  lightLoad     = 32,
  standby       = 36,
  mediaState    = "idle",
  motionOut     = "off",
  motionIn      = "off",
  windowAway    = 0,
  laundryDone   = 0,
} = {}) {
  mockUseEntityNum.mockImplementation((id: string) => {
    const map: Record<string, number> = {
      "sensor.ems_presence_mode": presenceMode,
      "sensor.ems_jasnosc_cyrkadianowa": brightness,
      "sensor.ems_temperatura_barwowa_cyrkadianowa": colorTempK,
      "sensor.ems_oswietlenie_load": lightLoad,
      "sensor.ems_standby_load": standby,
      "sensor.ems_rule_window_away": windowAway,
      "sensor.ems_rule_laundry_done": laundryDone,
    }
    return map[id] ?? 0
  })
  mockUseEntityState.mockImplementation((id: string) => {
    const map: Record<string, string> = {
      "input_select.ems_tryb_obecnosci": presenceStr,
      "sensor.ems_tryb_mediow": mediaState,
      "binary_sensor.ems_czujnik_ruchu_zewnetrzny": motionOut,
      "binary_sensor.ems_czujnik_ruchu_wewnetrzny": motionIn,
    }
    return map[id] ?? ""
  })
}

// ── tests ─────────────────────────────────────────────────────────────────────

async function renderPresence() {
  const { Presence } = await import("@/components/Presence")
  return render(<Presence />)
}

describe("Presence — mode display", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupEntities()
  })

  it("shows mode Home label when presenceMode=0", async () => {
    setupEntities({ presenceMode: 0 })
    await renderPresence()
    // Label appears in the mode card AND in Select items — check at least one exists
    expect(screen.getAllByText("presence.modeHome").length).toBeGreaterThan(0)
  })

  it("shows mode Away label when presenceMode=1", async () => {
    setupEntities({ presenceMode: 1 })
    await renderPresence()
    expect(screen.getAllByText("presence.modeAway").length).toBeGreaterThan(0)
  })

  it("shows mode Vacation label when presenceMode=2", async () => {
    setupEntities({ presenceMode: 2 })
    await renderPresence()
    expect(screen.getAllByText("presence.modeVacation").length).toBeGreaterThan(0)
  })

  it("clamps mode index to [0,2] for invalid values", async () => {
    setupEntities({ presenceMode: 99 })
    await renderPresence()
    expect(screen.getAllByText("presence.modeVacation").length).toBeGreaterThan(0)
  })
})

describe("Presence — motion sensors", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows no-motion label when sensors are off", async () => {
    setupEntities({ motionOut: "off", motionIn: "off" })
    await renderPresence()
    // Both outdoor and indoor show "clear"
    expect(screen.getAllByText("presence.motionClear").length).toBe(2)
  })

  it("shows detected label when outdoor motion active", async () => {
    setupEntities({ motionOut: "on", motionIn: "off" })
    await renderPresence()
    expect(screen.getByText("presence.motionDetected")).toBeInTheDocument()
    expect(screen.getByText("presence.motionClear")).toBeInTheDocument()
  })

  it("shows detected label when indoor motion active", async () => {
    setupEntities({ motionOut: "off", motionIn: "on" })
    await renderPresence()
    expect(screen.getByText("presence.motionDetected")).toBeInTheDocument()
  })
})

describe("Presence — media player state", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows idle state", async () => {
    setupEntities({ mediaState: "idle" })
    await renderPresence()
    expect(screen.getByText("presence.mediaIdle")).toBeInTheDocument()
  })

  it("shows playing state with LIVE indicator", async () => {
    setupEntities({ mediaState: "playing" })
    await renderPresence()
    expect(screen.getByText("presence.mediaPlaying")).toBeInTheDocument()
    expect(screen.getByText("● LIVE")).toBeInTheDocument()
  })

  it("shows paused state without LIVE indicator", async () => {
    setupEntities({ mediaState: "paused" })
    await renderPresence()
    expect(screen.getByText("presence.mediaPaused")).toBeInTheDocument()
    expect(screen.queryByText("● LIVE")).not.toBeInTheDocument()
  })
})

describe("Presence — rule alerts", () => {
  beforeEach(() => vi.clearAllMocks())

  it("hides rule alerts when no rules active", async () => {
    setupEntities({ windowAway: 0, laundryDone: 0 })
    await renderPresence()
    expect(screen.queryByText("presence.ruleWindowAway")).not.toBeInTheDocument()
    expect(screen.queryByText("presence.ruleLaundryDone")).not.toBeInTheDocument()
  })

  it("shows window_away alert when active", async () => {
    setupEntities({ windowAway: 1 })
    await renderPresence()
    expect(screen.getByText("presence.ruleWindowAway")).toBeInTheDocument()
  })

  it("shows laundry_done alert when active", async () => {
    setupEntities({ laundryDone: 1 })
    await renderPresence()
    expect(screen.getByText("presence.ruleLaundryDone")).toBeInTheDocument()
  })
})

describe("Presence — lighting stats", () => {
  beforeEach(() => vi.clearAllMocks())

  it("displays brightness and CT values", async () => {
    setupEntities({ brightness: 75, colorTempK: 3200 })
    await renderPresence()
    expect(screen.getByText("75")).toBeInTheDocument()
    expect(screen.getByText("3200")).toBeInTheDocument()
  })

  it("displays standby load", async () => {
    setupEntities({ standby: 41 })
    await renderPresence()
    expect(screen.getByText(/41/)).toBeInTheDocument()
  })
})
