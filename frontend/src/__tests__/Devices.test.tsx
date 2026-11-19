import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

// ── mocks ─────────────────────────────────────────────────────────────────────

const mockUseEntitiesByDomain = vi.fn()
const mockEntities = vi.fn()
const mockAreaOf = vi.fn<() => Record<string, string>>(() => ({}))
const mockUseEntity = vi.fn()

vi.mock("@/hooks/useHA", () => ({
  useHA: () => ({ entities: mockEntities(), areaOf: mockAreaOf(), callService: vi.fn() }),
  useEntity: (id: string) => mockUseEntity(id),
  useEntitiesByDomain: (domain: string) => mockUseEntitiesByDomain(domain),
  useEntitiesInArea: () => [],
}))

vi.mock("@/hooks/useCommittedSlider", () => ({
  useCommittedSlider: (v: number) => ({ display: v, sliderProps: { value: [v] } }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "en" } }),
}))

function entity(id: string, state: string, attrs: Record<string, unknown> = {}) {
  return { entity_id: id, state, attributes: attrs }
}

async function renderDevices() {
  const { Devices } = await import("@/components/Devices")
  return render(<Devices />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Devices", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseEntitiesByDomain.mockReturnValue([])
    mockEntities.mockReturnValue({})
    mockUseEntity.mockImplementation((id: string) => entity(id, "closed", { friendly_name: id }))
  })

  it("shows empty state when nothing is discovered", async () => {
    await renderDevices()
    expect(screen.getByText("devices.empty")).toBeInTheDocument()
  })

  it("queries the controllable domains", async () => {
    await renderDevices()
    expect(mockUseEntitiesByDomain).toHaveBeenCalledWith("cover")
    expect(mockUseEntitiesByDomain).toHaveBeenCalledWith("lock")
    expect(mockUseEntitiesByDomain).toHaveBeenCalledWith("climate")
  })

  it("renders the controllable section when a cover exists", async () => {
    mockUseEntitiesByDomain.mockImplementation((d: string) => (d === "cover" ? ["cover.gate"] : []))
    mockUseEntity.mockReturnValue(entity("cover.gate", "open", {
      friendly_name: "Gate", current_position: 50,
    }))
    await renderDevices()
    expect(screen.getByText("devices.controllable")).toBeInTheDocument()
    expect(screen.getByText("Gate")).toBeInTheDocument()
  })

  it("auto-discovers binary sensors from the entities map", async () => {
    mockEntities.mockReturnValue({
      "binary_sensor.smoke": entity("binary_sensor.smoke", "off", {
        friendly_name: "Smoke", device_class: "smoke",
      }),
      "binary_sensor.window": entity("binary_sensor.window", "on", {
        friendly_name: "Window", device_class: "window",
      }),
    })
    await renderDevices()
    expect(screen.getByText("devices.contacts")).toBeInTheDocument()
    expect(screen.getByText("Smoke")).toBeInTheDocument()
    expect(screen.getByText("Window")).toBeInTheDocument()
  })

  it("excludes room-assigned devices (rendered inside their room instead)", async () => {
    mockEntities.mockReturnValue({
      // living window is assigned to the Salon room → must NOT appear here
      "binary_sensor.ems_simulator_living_window": entity(
        "binary_sensor.ems_simulator_living_window", "off",
        { friendly_name: "Living Window", device_class: "window" },
      ),
      // a house-wide contact → should appear
      "binary_sensor.ems_simulator_smoke_detector": entity(
        "binary_sensor.ems_simulator_smoke_detector", "off",
        { friendly_name: "Smoke", device_class: "smoke" },
      ),
    })
    await renderDevices()
    expect(screen.getByText("Smoke")).toBeInTheDocument()
    expect(screen.queryByText("Living Window")).not.toBeInTheDocument()
  })

  it("filters environment sensors by device_class", async () => {
    mockEntities.mockReturnValue({
      "sensor.humidity": entity("sensor.humidity", "45", {
        friendly_name: "Humidity", device_class: "humidity", unit_of_measurement: "%",
      }),
      "sensor.random_power": entity("sensor.random_power", "1200", {
        friendly_name: "Random Power", device_class: "power", unit_of_measurement: "W",
      }),
    })
    await renderDevices()
    expect(screen.getByText("devices.environment")).toBeInTheDocument()
    expect(screen.getByText("Humidity")).toBeInTheDocument()
    // a power sensor is not an environment device → excluded
    expect(screen.queryByText("Random Power")).not.toBeInTheDocument()
  })

  it("excludes hardware Home Assistant has put in a room", async () => {
    // The static ROOM_DEVICE_IDS map cannot know about this one: the room card
    // finds it by area, so the house-wide view has to leave it out by area too
    // or the same device shows up in both places.
    mockEntities.mockReturnValue({
      "light.wled": entity("light.wled", "on", { friendly_name: "WLED" }),
      "binary_sensor.front_door": entity(
        "binary_sensor.front_door", "off",
        { friendly_name: "Front Door", device_class: "door" },
      ),
    })
    mockAreaOf.mockReturnValue({ "light.wled": "Salon" })
    mockUseEntitiesByDomain.mockImplementation((d: string) =>
      d === "light" ? ["light.wled"] : [])

    await renderDevices()

    expect(screen.queryByText("WLED")).not.toBeInTheDocument()
    expect(screen.getByText("Front Door")).toBeInTheDocument()
  })
})
