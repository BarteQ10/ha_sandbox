import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockUseEntityNum = vi.fn()
const mockUseEntityState = vi.fn()

vi.mock("@/hooks/useHA", () => ({
  useEntityNum:   (id: string, def = 0) => mockUseEntityNum(id, def),
  useEntityState: (id: string, def = "") => mockUseEntityState(id, def),
}))

// DecisionChart fetches HA history — stub fetchHistoryMulti to stay offline
vi.mock("@/api/haClient", () => ({
  fetchHistoryMulti: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: "en" },
  }),
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function setup({
  mpcAction = 0, rlAction = 0, rlEnabled = false, epsilon = 0, ticks = 0,
} = {}) {
  mockUseEntityNum.mockImplementation((id: string) => {
    const map: Record<string, number> = {
      "sensor.ems_mpc_akcja": mpcAction,
      "sensor.ems_rl_akcja": rlAction,
      "sensor.ems_rl_epsilon": epsilon,
      "sensor.ems_rl_ticks": ticks,
    }
    return map[id] ?? 0
  })
  mockUseEntityState.mockImplementation((id: string) =>
    id === "sensor.ems_rl_wlaczony" ? (rlEnabled ? "True" : "False") : "",
  )
}

async function renderCompare() {
  const { MpcRlCompare } = await import("@/components/MpcRlCompare")
  return render(<MpcRlCompare />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("MpcRlCompare", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setup()
  })

  it("renders title", async () => {
    await renderCompare()
    expect(screen.getByText("compare.title")).toBeInTheDocument()
  })

  it("shows RL OFF badge and disabled note when RL disabled", async () => {
    setup({ rlEnabled: false })
    await renderCompare()
    expect(screen.getByText("RL OFF")).toBeInTheDocument()
    expect(screen.getByText("compare.rlDisabled")).toBeInTheDocument()
  })

  it("shows RL ON badge and training progress when RL enabled", async () => {
    setup({ rlEnabled: true, epsilon: 0.5, ticks: 1234 })
    await renderCompare()
    expect(screen.getByText("RL ON")).toBeInTheDocument()
    expect(screen.getByText("50.0%")).toBeInTheDocument()
  })

  it("shows agree indicator when actions match", async () => {
    setup({ rlEnabled: true, mpcAction: 1, rlAction: 1 })
    await renderCompare()
    expect(screen.getByText("compare.agree")).toBeInTheDocument()
  })

  it("shows diverge indicator when actions differ", async () => {
    setup({ rlEnabled: true, mpcAction: 1, rlAction: 2 })
    await renderCompare()
    expect(screen.getByText("compare.diverge")).toBeInTheDocument()
  })

  it("applied decision follows RL when RL enabled and non-auto", async () => {
    // RL says Discharge (2), MPC says Charge (1) → applied should be Discharge
    setup({ rlEnabled: true, mpcAction: 1, rlAction: 2 })
    await renderCompare()
    // 3 badges: MPC=Charge, RL=Discharge, Applied=Discharge → two "discharge" labels
    expect(screen.getAllByText("compare.discharge").length).toBe(2)
  })

  it("applied decision falls back to MPC when RL disabled", async () => {
    setup({ rlEnabled: false, mpcAction: 1, rlAction: 2 })
    await renderCompare()
    // RL badge shows Auto (forced 0 when disabled), Applied follows MPC=Charge
    expect(screen.getAllByText("compare.charge").length).toBe(2) // MPC + Applied
  })
})
