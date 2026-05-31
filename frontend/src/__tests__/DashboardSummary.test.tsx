import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockUseEntityNum = vi.fn()
const mockUseWeekReport = vi.fn()

vi.mock("@/hooks/useHA", () => ({
  useEntityNum: (id: string, def = 0) => mockUseEntityNum(id, def),
}))

vi.mock("@/hooks/useWeekReport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useWeekReport")>()
  return {
    ...actual,
    useWeekReport: () => mockUseWeekReport(),
  }
})

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: "en" },
  }),
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function setup({
  pv = 0, load = 0, soc = 50, balToday = 0, soh = 1,
  rows = [], loading = false,
}: {
  pv?: number; load?: number; soc?: number; balToday?: number; soh?: number
  rows?: unknown[]; loading?: boolean
} = {}) {
  mockUseEntityNum.mockImplementation((id: string) => {
    const map: Record<string, number> = {
      "sensor.sztuczna_produkcja_pv": pv,
      "sensor.ems_pobor_domu_bazowy": load,
      "sensor.sztuczny_stan_baterii_soc": soc,
      "sensor.ems_bilans_finansowy_dzis": balToday,
      "sensor.ems_battery_soh": soh,
    }
    return map[id] ?? 0
  })
  mockUseWeekReport.mockReturnValue({ rows, loading })
}

async function renderSummary() {
  const { DashboardSummary } = await import("@/components/DashboardSummary")
  return render(<DashboardSummary />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("DashboardSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setup()
  })

  it("renders the title", async () => {
    await renderSummary()
    expect(screen.getByText("summary.title")).toBeInTheDocument()
  })

  it("shows live PV and load values", async () => {
    setup({ pv: 3421, load: 850 })
    await renderSummary()
    expect(screen.getByText("3421")).toBeInTheDocument()
    expect(screen.getByText("850")).toBeInTheDocument()
  })

  it("converts SoH fraction to percentage", async () => {
    setup({ soh: 0.982 })
    await renderSummary()
    expect(screen.getByText("98.2")).toBeInTheDocument()
  })

  it("shows surplus when PV exceeds load", async () => {
    setup({ pv: 2000, load: 500 })
    await renderSummary()
    expect(screen.getByText(/summary.surplus/)).toBeInTheDocument()
  })

  it("shows deficit when load exceeds PV", async () => {
    setup({ pv: 200, load: 900 })
    await renderSummary()
    expect(screen.getByText(/summary.deficit/)).toBeInTheDocument()
  })

  it("formats positive balance with a + sign", async () => {
    setup({ balToday: 4.5 })
    await renderSummary()
    expect(screen.getByText("+4.50")).toBeInTheDocument()
  })

  it("shows loading placeholder for self-consumption while loading", async () => {
    setup({ loading: true })
    await renderSummary()
    expect(screen.getByText("…")).toBeInTheDocument()
  })
})
