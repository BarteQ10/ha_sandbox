import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockUseEntitiesByDomain = vi.fn()

vi.mock("@/hooks/useHA", () => ({
  useEntitiesByDomain: (domain: string) => mockUseEntitiesByDomain(domain),
}))

// Stub CameraView so we test the grid/discovery, not the image plumbing
vi.mock("@/components/CameraView", () => ({
  CameraView: ({ entityId }: { entityId: string }) => <div data-testid="camera">{entityId}</div>,
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}))

async function renderCameras() {
  const { Cameras } = await import("@/components/Cameras")
  return render(<Cameras />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Cameras", () => {
  beforeEach(() => vi.clearAllMocks())

  it("queries the camera domain", async () => {
    mockUseEntitiesByDomain.mockReturnValue([])
    await renderCameras()
    expect(mockUseEntitiesByDomain).toHaveBeenCalledWith("camera")
  })

  it("shows empty state when no cameras exist", async () => {
    mockUseEntitiesByDomain.mockReturnValue([])
    await renderCameras()
    expect(screen.getByText("cameras.empty")).toBeInTheDocument()
  })

  it("renders one CameraView per discovered camera", async () => {
    mockUseEntitiesByDomain.mockReturnValue(["camera.ogrod", "camera.garaz", "camera.wejscie"])
    await renderCameras()
    const cams = screen.getAllByTestId("camera")
    expect(cams).toHaveLength(3)
    expect(cams.map((c) => c.textContent)).toEqual(["camera.ogrod", "camera.garaz", "camera.wejscie"])
  })

  it("shows the camera count badge", async () => {
    mockUseEntitiesByDomain.mockReturnValue(["camera.a", "camera.b"])
    await renderCameras()
    expect(screen.getByText("2")).toBeInTheDocument()
  })
})
