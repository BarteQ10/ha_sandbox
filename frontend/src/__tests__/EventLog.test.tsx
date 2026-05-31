import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockFetchEvents = vi.fn()

vi.mock("@/api/events", () => ({
  fetchEvents: (opts: unknown) => mockFetchEvents(opts),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      opts ? `${k}:${JSON.stringify(opts)}` : k,
    i18n: { language: "en" },
  }),
}))

// ── fixtures ───────────────────────────────────────────────────────────────────

const now = Date.now() / 1000
const RESPONSE = {
  events: [
    { id: 3, ts: now - 30,   category: "security", severity: "warning",  message: "Indoor motion while away" },
    { id: 2, ts: now - 600,  category: "grid",     severity: "critical", message: "Grid blackout" },
    { id: 1, ts: now - 4000, category: "anomaly",  severity: "warning",  message: "PV underperforming" },
  ],
  stats: { total: 3, by_category: { anomaly: 1, rule: 0, security: 1, energy: 0, media: 0, grid: 1 } },
  categories: ["anomaly", "rule", "security", "energy", "media", "grid"],
}

async function renderLog() {
  const { EventLog } = await import("@/components/EventLog")
  return render(<EventLog />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("EventLog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchEvents.mockResolvedValue(RESPONSE)
  })

  it("renders title and the events after load", async () => {
    await renderLog()
    await waitFor(() => {
      expect(screen.getByText("Indoor motion while away")).toBeInTheDocument()
    })
    expect(screen.getByText("Grid blackout")).toBeInTheDocument()
    expect(screen.getByText("PV underperforming")).toBeInTheDocument()
  })

  it("shows empty state when there are no events", async () => {
    mockFetchEvents.mockResolvedValue({ events: [], stats: { total: 0, by_category: {} }, categories: [] })
    await renderLog()
    await waitFor(() => {
      expect(screen.getByText("events.empty")).toBeInTheDocument()
    })
  })

  it("shows error state when fetch fails", async () => {
    mockFetchEvents.mockRejectedValue(new Error("network"))
    await renderLog()
    await waitFor(() => {
      expect(screen.getByText("events.error")).toBeInTheDocument()
    })
  })

  it("filters by category when a chip is clicked", async () => {
    await renderLog()
    await waitFor(() => expect(screen.getByText("Grid blackout")).toBeInTheDocument())

    // Click the "security" category chip (label via i18n key events.cat.security)
    const chips = screen.getAllByText("events.cat.security")
    await userEvent.click(chips[0])

    await waitFor(() => {
      expect(mockFetchEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "security" }),
      )
    })
  })

  it("toggles auto-refresh pause/resume", async () => {
    await renderLog()
    await waitFor(() => expect(screen.getByText("Grid blackout")).toBeInTheDocument())
    const pauseBtn = screen.getByLabelText("events.pause")
    await userEvent.click(pauseBtn)
    // After pausing, the resume control is shown
    expect(screen.getByLabelText("events.resume")).toBeInTheDocument()
  })
})
