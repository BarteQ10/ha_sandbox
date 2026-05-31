import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockUseEntity = vi.fn()
const mockUseEntityState = vi.fn()

vi.mock("@/hooks/useHA", () => ({
  useEntity: (id: string) => mockUseEntity(id),
  useEntityState: (id: string, def = "0") => mockUseEntityState(id, def),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function camEntity(picture = "/api/camera_proxy/camera.ogrod?token=abc") {
  return {
    state: "streaming",
    attributes: { entity_picture: picture, friendly_name: "Garden Cam" },
  }
}

async function renderCamera(props: Record<string, unknown> = {}) {
  const { CameraView } = await import("@/components/CameraView")
  return render(<CameraView entityId="camera.ogrod" {...props} />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("CameraView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntityState.mockReturnValue("off")
  })

  it("shows unavailable placeholder when entity is missing", async () => {
    mockUseEntity.mockReturnValue(undefined)
    await renderCamera()
    expect(screen.getByText("camera.unavailable")).toBeInTheDocument()
  })

  it("shows unavailable when entity has no entity_picture", async () => {
    mockUseEntity.mockReturnValue({ state: "idle", attributes: {} })
    await renderCamera()
    expect(screen.getByText("camera.unavailable")).toBeInTheDocument()
  })

  it("renders an img with HA_URL + entity_picture for snapshots", async () => {
    mockUseEntity.mockReturnValue(camEntity())
    await renderCamera()
    const img = screen.getByRole("img") as HTMLImageElement
    expect(img.src).toContain("/api/camera_proxy/camera.ogrod")
    expect(img.src).toContain("token=abc")
    // snapshot mode appends a cache-buster
    expect(img.src).toContain("_=")
  })

  it("uses the stream proxy path and shows LIVE badge in stream mode", async () => {
    mockUseEntity.mockReturnValue(camEntity())
    await renderCamera({ stream: true })
    const img = screen.getByRole("img") as HTMLImageElement
    expect(img.src).toContain("/api/camera_proxy_stream/camera.ogrod")
    expect(screen.getByText("camera.live")).toBeInTheDocument()
  })

  it("shows the friendly name label", async () => {
    mockUseEntity.mockReturnValue(camEntity())
    await renderCamera()
    expect(screen.getByText("Garden Cam")).toBeInTheDocument()
  })

  it("shows MOTION badge when motion entity is on", async () => {
    mockUseEntity.mockReturnValue(camEntity())
    mockUseEntityState.mockImplementation((id: string) =>
      id === "binary_sensor.motion" ? "on" : "off",
    )
    await renderCamera({ motionEntity: "binary_sensor.motion" })
    expect(screen.getByText("camera.motion")).toBeInTheDocument()
  })

  it("hides MOTION badge when motion entity is off", async () => {
    mockUseEntity.mockReturnValue(camEntity())
    mockUseEntityState.mockReturnValue("off")
    await renderCamera({ motionEntity: "binary_sensor.motion" })
    expect(screen.queryByText("camera.motion")).not.toBeInTheDocument()
  })
})
