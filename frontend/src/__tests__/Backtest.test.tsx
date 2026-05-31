import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockRunBacktest = vi.fn()

vi.mock("@/api/backtest", () => ({
  runBacktest: (days: number) => mockRunBacktest(days),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: "en" },
  }),
}))

const SAMPLE = {
  days: 7,
  rows: 168,
  from: "2026-05-24T00:00:00",
  to: "2026-05-31T00:00:00",
  best: "mpc (price-adaptive)",
  savings_pln: 12.34,
  savings_year_est: 643,
  timeline: ["2026-05-24T00:00:00", "2026-05-24T01:00:00"],
  strategies: [
    { name: "baseline (no battery)", cost_pln: 50, savings_pct: 0, import_kwh: 100, export_kwh: 5, self_sufficiency: 0.3, charge_cycles: 0, cumulative_cost: [10, 50] },
    { name: "auto (no scheduling)", cost_pln: 42, savings_pct: 16, import_kwh: 80, export_kwh: 3, self_sufficiency: 0.5, charge_cycles: 4, cumulative_cost: [8, 42] },
    { name: "scheduled (overnight cheap charge)", cost_pln: 40, savings_pct: 20, import_kwh: 78, export_kwh: 2, self_sufficiency: 0.55, charge_cycles: 5, cumulative_cost: [7, 40] },
    { name: "mpc (price-adaptive)", cost_pln: 37.66, savings_pct: 24.7, import_kwh: 70, export_kwh: 2, self_sufficiency: 0.6, charge_cycles: 6, cumulative_cost: [6, 37.66] },
  ],
}

async function renderBacktest() {
  const { Backtest } = await import("@/components/Backtest")
  return render(<Backtest />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Backtest", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders title and run button", async () => {
    await renderBacktest()
    expect(screen.getByText("backtest.title")).toBeInTheDocument()
    expect(screen.getByText("backtest.run")).toBeInTheDocument()
  })

  it("shows the hint before any run", async () => {
    await renderBacktest()
    expect(screen.getByText("backtest.hint")).toBeInTheDocument()
  })

  it("runs backtest and shows best strategy + savings", async () => {
    mockRunBacktest.mockResolvedValue(SAMPLE)
    await renderBacktest()
    await userEvent.click(screen.getByText("backtest.run"))
    await waitFor(() => {
      expect(screen.getByText("backtest.bestStrategy")).toBeInTheDocument()
    })
    expect(mockRunBacktest).toHaveBeenCalledWith(7)
    expect(screen.getByText(/12\.34 zł/)).toBeInTheDocument()
  })

  it("renders a table row per strategy", async () => {
    mockRunBacktest.mockResolvedValue(SAMPLE)
    await renderBacktest()
    await userEvent.click(screen.getByText("backtest.run"))
    await waitFor(() => {
      expect(screen.getByText("baseline")).toBeInTheDocument()
    })
    expect(screen.getByText("auto")).toBeInTheDocument()
    expect(screen.getByText("scheduled")).toBeInTheDocument()
    // "mpc" appears in best card + table → at least one
    expect(screen.getAllByText("mpc").length).toBeGreaterThan(0)
  })

  it("shows no-data message when backend reports no_data", async () => {
    mockRunBacktest.mockRejectedValue(new Error("no_data"))
    await renderBacktest()
    await userEvent.click(screen.getByText("backtest.run"))
    await waitFor(() => {
      expect(screen.getByText("backtest.noData")).toBeInTheDocument()
    })
  })

  it("passes the selected period to runBacktest", async () => {
    mockRunBacktest.mockResolvedValue({ ...SAMPLE, days: 14 })
    await renderBacktest()
    await userEvent.click(screen.getByText("14backtest.daysUnit"))
    await userEvent.click(screen.getByText("backtest.run"))
    await waitFor(() => expect(mockRunBacktest).toHaveBeenCalledWith(14))
  })
})
