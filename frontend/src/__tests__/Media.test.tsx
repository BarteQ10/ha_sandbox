import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockUseEntitiesByDomain = vi.fn()
const mockUseEntityState = vi.fn()

vi.mock("@/hooks/useHA", () => ({
  useEntitiesByDomain: (domain: string) => mockUseEntitiesByDomain(domain),
  useEntityState: (id: string, def = "") => mockUseEntityState(id, def),
}))

vi.mock("@/components/MediaControl", () => ({
  MediaControl: ({ entityId }: { entityId: string }) => <div data-testid="player">{entityId}</div>,
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}))

async function renderMedia() {
  const { Media } = await import("@/components/Media")
  return render(<Media />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Media", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntityState.mockReturnValue("idle")
  })

  it("queries the media_player domain", async () => {
    mockUseEntitiesByDomain.mockReturnValue([])
    await renderMedia()
    expect(mockUseEntitiesByDomain).toHaveBeenCalledWith("media_player")
  })

  it("shows empty state and simulated fallback when no players exist", async () => {
    mockUseEntitiesByDomain.mockReturnValue([])
    await renderMedia()
    expect(screen.getByText("media.empty")).toBeInTheDocument()
    expect(screen.getByText("media.simulated")).toBeInTheDocument()
  })

  it("renders one MediaControl per discovered player", async () => {
    mockUseEntitiesByDomain.mockReturnValue(["media_player.salon", "media_player.kuchnia"])
    await renderMedia()
    const players = screen.getAllByTestId("player")
    expect(players).toHaveLength(2)
    expect(players.map((p) => p.textContent)).toEqual(["media_player.salon", "media_player.kuchnia"])
  })

  it("does not show the simulated fallback when real players exist", async () => {
    mockUseEntitiesByDomain.mockReturnValue(["media_player.salon"])
    await renderMedia()
    expect(screen.queryByText("media.simulated")).not.toBeInTheDocument()
  })

  it("shows the player count badge", async () => {
    mockUseEntitiesByDomain.mockReturnValue(["media_player.a", "media_player.b", "media_player.c"])
    await renderMedia()
    expect(screen.getByText("3")).toBeInTheDocument()
  })
})
