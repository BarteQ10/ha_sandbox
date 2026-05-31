import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockCallService = vi.fn()
const mockUseEntityState = vi.fn()
const mockUseEntityNum = vi.fn()

vi.mock("@/hooks/useHA", () => ({
  useEntityState:  (id: string, def = "") => mockUseEntityState(id, def),
  useEntityNum:    (id: string, def = 0)  => mockUseEntityNum(id, def),
  useHA:           () => ({ callService: mockCallService }),
}))

vi.mock("@/hooks/useCommittedSlider", () => ({
  useCommittedSlider: (_val: number, _cb: unknown) => ({
    display: 0,
    sliderProps: { value: [0], onValueChange: vi.fn() },
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: "en" },
  }),
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function setupDefaults() {
  mockUseEntityState.mockReturnValue("off")
  mockUseEntityNum.mockReturnValue(0)
}

async function renderControls() {
  const { Controls } = await import("@/components/Controls")
  return render(<Controls />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Controls — renders without error", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
  })

  it("renders title", async () => {
    await renderControls()
    expect(screen.getByText("controls.title")).toBeInTheDocument()
  })

  it("renders inverter mode select", async () => {
    await renderControls()
    expect(screen.getByText("controls.inverterMode")).toBeInTheDocument()
  })

  it("renders heat pump mode select", async () => {
    await renderControls()
    expect(screen.getByText("controls.heatPumpMode")).toBeInTheDocument()
  })

  it("renders grid status select", async () => {
    await renderControls()
    expect(screen.getByText("controls.gridStatus")).toBeInTheDocument()
  })
})

describe("Controls — Presence & Smart Devices section", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
  })

  it("renders section header", async () => {
    await renderControls()
    expect(screen.getByText("controls.presenceDevices")).toBeInTheDocument()
  })

  it("renders presence mode select", async () => {
    await renderControls()
    expect(screen.getByText("controls.presence")).toBeInTheDocument()
  })

  it("renders V2G switch", async () => {
    await renderControls()
    expect(screen.getByText("controls.v2g")).toBeInTheDocument()
  })

  it("renders smart socket TV switch", async () => {
    await renderControls()
    expect(screen.getByText("controls.smartSocketTv")).toBeInTheDocument()
  })
})

describe("Controls — storm safeguard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
  })

  it("shows storm activate button", async () => {
    await renderControls()
    expect(screen.getByText("controls.stormActivate")).toBeInTheDocument()
  })

  it("shows storm deactivate button", async () => {
    await renderControls()
    expect(screen.getByText("controls.stormDeactivate")).toBeInTheDocument()
  })
})

describe("Controls — EV controls", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
  })

  it("renders EV limit slider label", async () => {
    await renderControls()
    expect(screen.getByText(/controls.evLimit/)).toBeInTheDocument()
  })

  it("renders degradation cost slider label", async () => {
    await renderControls()
    expect(screen.getByText(/controls.degradationCost/)).toBeInTheDocument()
  })
})
