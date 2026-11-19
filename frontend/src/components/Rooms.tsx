import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { useEntityState, useEntityNum, useHA } from "@/hooks/useHA"
import { useCommittedSlider } from "@/hooks/useCommittedSlider"
import { useEntitiesInArea } from "@/hooks/useHA"
import { CameraView } from "@/components/CameraView"
import {
  CoverControl, LockControl, ClimateControl, BinaryChip, EntityControl, SensorTile, ENV_CLASSES,
} from "@/components/DeviceControls"
import {
  Sofa, CookingPot, Bed, Bath, TreePine,
  Lightbulb, Thermometer, Droplets, Blinds,
} from "lucide-react"

function kelvinToRgb(k: number): string {
  const t = k / 100
  let r: number, g: number, b: number
  if (t <= 66) {
    r = 255
    g = 99.4708025861 * Math.log(t) - 161.1195681661
    b = t <= 20 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
    b = 255
  }
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)))
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`
}

interface RgbChannels {
  r: string
  g: string
  b: string
}

interface LightConfig {
  entityId: string
  nameKey: string
  brightnessEntity?: string
  colorTempEntity?: string
  rgbEntities?: RgbChannels
}

interface RoomConfig {
  id: string
  nameKey: string
  /**
   * The Home Assistant area this room stands for.
   *
   * Everything else on a room card is the simulator, named entity by entity in
   * the map below — which is why no amount of real equipment ever showed up in
   * one. Whatever Home Assistant has assigned to this area is rendered
   * alongside it, so a new device appears by being given a room in HA rather
   * than by editing this file. Rooms the simulator invented have no counterpart
   * area and simply leave it unset.
   */
  areaName?: string
  icon: React.ElementType
  color: string
  tempEntity: string
  lights: LightConfig[]
  shutterEntity?: string
  humidityEntity?: string
  setpointEntity?: string
  cameraEntity?: string      // HA camera.* entity (optional)
  motionEntity?: string      // binary_sensor.* for a MOTION badge (optional)
  // Auxiliary MQTT smart devices assigned to this room (rendered as cards/chips).
  climateEntity?: string     // climate.* (TRV / thermostat)
  lockEntity?: string        // lock.*
  coverEntity?: string       // cover.* (gate / blind motor)
  contactEntities?: string[] // binary_sensor.* shown as status chips
}

const rooms: RoomConfig[] = [
  {
    id: "salon",
    nameKey: "rooms.salon",
    areaName: "Salon",
    icon: Sofa,
    color: "#ffa726",
    tempEntity: "input_number.wirtualna_temp_salon",
    setpointEntity: "input_number.wirtualne_ustawienie_temp_salon",
    lights: [
      { entityId: "input_boolean.wirtualne_swiatlo_salon_glowne", nameKey: "lights.main" },
      {
        entityId: "input_boolean.wirtualne_swiatlo_salon_lampa",
        nameKey: "lights.floorLamp",
        brightnessEntity: "input_number.wirtualne_jasnosc_salon_lampa",
        colorTempEntity: "input_number.wirtualne_barwa_salon_lampa",
      },
      {
        entityId: "input_boolean.wirtualne_swiatlo_salon_led",
        nameKey: "lights.led",
        rgbEntities: {
          r: "input_number.wirtualne_rgb_salon_led_r",
          g: "input_number.wirtualne_rgb_salon_led_g",
          b: "input_number.wirtualne_rgb_salon_led_b",
        },
      },
    ],
    shutterEntity: "input_number.wirtualne_rolety_salon",
    climateEntity: "climate.ems_simulator_living_room_trv",
    contactEntities: ["binary_sensor.ems_simulator_living_window"],
  },
  {
    id: "kuchnia",
    nameKey: "rooms.kitchen",
    areaName: "Kuchnia",
    icon: CookingPot,
    color: "#66bb6a",
    tempEntity: "input_number.wirtualna_temp_kuchnia",
    setpointEntity: "input_number.wirtualne_ustawienie_temp_kuchnia",
    lights: [
      { entityId: "input_boolean.wirtualne_swiatlo_kuchnia_glowne", nameKey: "lights.main" },
      {
        entityId: "input_boolean.wirtualne_swiatlo_kuchnia_wyspa",
        nameKey: "lights.island",
        brightnessEntity: "input_number.wirtualne_jasnosc_kuchnia_wyspa",
      },
      {
        entityId: "input_boolean.wirtualne_swiatlo_kuchnia_led",
        nameKey: "lights.led",
        rgbEntities: {
          r: "input_number.wirtualne_rgb_kuchnia_led_r",
          g: "input_number.wirtualne_rgb_kuchnia_led_g",
          b: "input_number.wirtualne_rgb_kuchnia_led_b",
        },
      },
    ],
    shutterEntity: "input_number.wirtualne_rolety_kuchnia",
    contactEntities: ["binary_sensor.ems_simulator_kitchen_leak"],
  },
  {
    id: "sypialnia",
    nameKey: "rooms.bedroom",
    areaName: "Sypialnia",
    icon: Bed,
    color: "#4fc3f7",
    tempEntity: "input_number.wirtualna_temp_sypialnia",
    setpointEntity: "input_number.wirtualne_ustawienie_temp_sypialnia",
    lights: [
      {
        entityId: "input_boolean.wirtualne_swiatlo_sypialnia_glowne",
        nameKey: "lights.main",
        brightnessEntity: "input_number.wirtualne_jasnosc_sypialnia_glowne",
      },
      {
        entityId: "input_boolean.wirtualne_swiatlo_sypialnia_lampka1",
        nameKey: "lights.lamp1",
        brightnessEntity: "input_number.wirtualne_jasnosc_sypialnia_lampka1",
        colorTempEntity: "input_number.wirtualne_barwa_sypialnia_lampka1",
      },
      {
        entityId: "input_boolean.wirtualne_swiatlo_sypialnia_lampka2",
        nameKey: "lights.lamp2",
        brightnessEntity: "input_number.wirtualne_jasnosc_sypialnia_lampka2",
        colorTempEntity: "input_number.wirtualne_barwa_sypialnia_lampka2",
      },
      { entityId: "input_boolean.wirtualne_swiatlo_sypialnia_kinkiet", nameKey: "lights.sconce" },
    ],
    shutterEntity: "input_number.wirtualne_rolety_sypialnia",
  },
  {
    id: "lazienka",
    nameKey: "rooms.bathroom",
    icon: Bath,
    color: "#ce93d8",
    tempEntity: "input_number.wirtualna_temp_lazienka",
    lights: [
      { entityId: "input_boolean.wirtualne_swiatlo_lazienka_glowne", nameKey: "lights.main" },
      {
        entityId: "input_boolean.wirtualne_swiatlo_lazienka_lustro",
        nameKey: "lights.ledMirror",
        brightnessEntity: "input_number.wirtualne_jasnosc_lazienka_lustro",
        colorTempEntity: "input_number.wirtualne_barwa_lazienka_lustro",
      },
    ],
    shutterEntity: "input_number.wirtualne_rolety_lazienka",
    humidityEntity: "input_number.wirtualna_wilgotnosc_lazienka",
  },
  {
    id: "ogrod",
    nameKey: "rooms.garden",
    icon: TreePine,
    color: "#81c784",
    tempEntity: "input_number.wirtualna_temp_ogrod",
    lights: [
      { entityId: "input_boolean.wirtualne_swiatlo_ogrod_glowne", nameKey: "lights.main" },
      { entityId: "input_boolean.wirtualne_swiatlo_ogrod_solarne", nameKey: "lights.solar" },
    ],
    cameraEntity: "camera.ogrod",
    motionEntity: "binary_sensor.ems_czujnik_ruchu_zewnetrzny",
  },
]

// Home Assistant areas that a room card stands for. The Devices tab uses this
// to leave out hardware a room is already showing, the same reason
// ROOM_DEVICE_IDS exists for the statically configured ones.
export const ROOM_AREA_NAMES = new Set<string>(
  rooms.map((r) => r.areaName).filter((x): x is string => Boolean(x)),
)

// Entity IDs of all room-assigned smart devices. The house-wide Devices tab
// imports this to avoid showing the same device in two places.
export const ROOM_DEVICE_IDS = new Set<string>(
  rooms.flatMap((r) =>
    [r.climateEntity, r.lockEntity, r.coverEntity, ...(r.contactEntities ?? [])]
      .filter((x): x is string => Boolean(x)),
  ),
)

function LightControl({ light, color }: { light: LightConfig; color: string }) {
  const { t } = useTranslation()
  const { callService } = useHA()
  const isOn = useEntityState(light.entityId) === "on"

  const setNumber = (entityId: string | undefined, value: number) => {
    if (entityId) callService("input_number", "set_value", { entity_id: entityId, value })
  }

  const brightness = useCommittedSlider(
    useEntityNum(light.brightnessEntity ?? "", 100),
    (v) => setNumber(light.brightnessEntity, v)
  )
  const colorTemp = useCommittedSlider(
    useEntityNum(light.colorTempEntity ?? "", 4000),
    (v) => setNumber(light.colorTempEntity, v)
  )
  const red = useCommittedSlider(
    useEntityNum(light.rgbEntities?.r ?? "", 255),
    (v) => setNumber(light.rgbEntities?.r, v)
  )
  const green = useCommittedSlider(
    useEntityNum(light.rgbEntities?.g ?? "", 255),
    (v) => setNumber(light.rgbEntities?.g, v)
  )
  const blue = useCommittedSlider(
    useEntityNum(light.rgbEntities?.b ?? "", 255),
    (v) => setNumber(light.rgbEntities?.b, v)
  )

  const rgbCss = `rgb(${red.display},${green.display},${blue.display})`

  return (
    <div
      className="rounded-md border p-2.5 space-y-2"
      style={{
        borderColor: isOn ? color : "var(--border)",
        backgroundColor: isOn ? `${color}12` : "transparent",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs">
          <Lightbulb
            className="h-3.5 w-3.5 shrink-0"
            style={{ color: isOn ? color : undefined }}
            fill={isOn ? color : "none"}
          />
          {t(light.nameKey)}
        </span>
        <Switch
          checked={isOn}
          className="scale-75"
          onCheckedChange={() =>
            callService("input_boolean", isOn ? "turn_off" : "turn_on", {
              entity_id: light.entityId,
            })
          }
        />
      </div>

      {isOn && light.brightnessEntity && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground w-6">{t("roomCard.brightness")}</span>
          <Slider min={0} max={100} step={1} className="flex-1" {...brightness.sliderProps} />
          <span className="text-[10px] text-muted-foreground w-6 text-right">{brightness.display}%</span>
        </div>
      )}

      {isOn && light.rgbEntities && (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: rgbCss }}
            />
            <span className="text-[10px] text-muted-foreground">RGB</span>
          </div>
          {[
            { ch: "r", label: "R", slider: red },
            { ch: "g", label: "G", slider: green },
            { ch: "b", label: "B", slider: blue },
          ].map(({ ch, label, slider }) => (
            <div className="flex items-center gap-2" key={ch}>
              <span
                className="text-[10px] font-bold w-3"
                style={{ color: ch === "r" ? "#ef4444" : ch === "g" ? "#22c55e" : "#3b82f6" }}
              >
                {label}
              </span>
              <Slider
                color={rgbCss}
                min={0}
                max={255}
                step={1}
                className="flex-1"
                {...slider.sliderProps}
              />
              <span className="text-[10px] text-muted-foreground w-6 text-right">{slider.display}</span>
            </div>
          ))}
        </div>
      )}

      {isOn && light.colorTempEntity && (
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: kelvinToRgb(colorTemp.display) }}
          />
          <Slider
            color={kelvinToRgb(colorTemp.display)}
            min={2700}
            max={6500}
            step={100}
            className="flex-1"
            {...colorTemp.sliderProps}
          />
          <span className="text-[10px] text-muted-foreground w-10 text-right">{colorTemp.display}K</span>
        </div>
      )}
    </div>
  )
}

function RoomCard({ room }: { room: RoomConfig }) {
  const { t } = useTranslation()
  const { entities, callService } = useHA()

  // Hardware Home Assistant puts in this room, minus anything the map above
  // already names, so a device configured by hand does not appear twice.
  const configured = new Set<string>(
    [
      room.tempEntity, room.setpointEntity, room.humidityEntity, room.shutterEntity,
      room.cameraEntity, room.motionEntity, room.climateEntity, room.lockEntity,
      room.coverEntity,
      ...(room.contactEntities ?? []),
      ...room.lights.flatMap((l) => [l.entityId, l.brightnessEntity, l.colorTempEntity]),
    ].filter((x): x is string => Boolean(x)),
  )
  const real = useEntitiesInArea(room.areaName).filter((id) => !configured.has(id))
  const realChips = real.filter((id) => id.startsWith("binary_sensor."))
  const realSensors = real.filter(
    (id) => id.startsWith("sensor.") &&
      ENV_CLASSES.has((entities[id]?.attributes?.device_class as string) ?? ""),
  )
  const realControls = real.filter(
    (id) => !id.startsWith("binary_sensor.") && !id.startsWith("sensor."),
  )

  // Read entity values from the context map directly so the number of hooks
  // stays constant regardless of which optional entities a room defines
  // (avoids conditional/loop hook calls — Rules of Hooks).
  const numOf = (id: string | undefined, fb: number) => {
    const s = id ? entities[id]?.state : undefined
    return s != null && s !== "" ? Number(s) : fb
  }

  const temp = numOf(room.tempEntity, 21)
  const humidity = room.humidityEntity ? numOf(room.humidityEntity, 50) : null
  const setpoint = numOf(room.setpointEntity, 21)
  const lightStates = room.lights.map((l) => entities[l.entityId]?.state === "on")
  const anyOn = lightStates.some(Boolean)
  const RoomIcon = room.icon

  const shutterPresent = room.shutterEntity !== undefined
  const shutter = useCommittedSlider(numOf(room.shutterEntity, 100), (v) => {
    if (room.shutterEntity)
      callService("input_number", "set_value", { entity_id: room.shutterEntity, value: v })
  })

  function setAll(target: "on" | "off") {
    room.lights.forEach((l, i) => {
      if ((target === "on" && !lightStates[i]) || (target === "off" && lightStates[i])) {
        callService("input_boolean", target === "on" ? "turn_on" : "turn_off", {
          entity_id: l.entityId,
        })
      }
    })
  }

  return (
    <Card className="overflow-hidden border-t-4" style={{ borderTopColor: room.color }}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RoomIcon className="h-5 w-5" style={{ color: room.color }} />
            <h3 className="font-semibold">{t(room.nameKey)}</h3>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex items-center gap-1 text-lg font-bold">
              <Thermometer className="h-4 w-4 text-muted-foreground" />
              {temp.toFixed(1)}°
              {humidity !== null && (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  <Droplets className="inline h-3 w-3" /> {humidity}%
                </span>
              )}
            </div>
            {room.setpointEntity && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground">{t("roomCard.setpoint")}</span>
                <button
                  className="flex h-5 w-5 items-center justify-center rounded-full border text-xs leading-none hover:bg-accent"
                  onClick={() =>
                    callService("input_number", "set_value", {
                      entity_id: room.setpointEntity,
                      value: Math.round((setpoint - 0.5) * 10) / 10,
                    })
                  }
                >
                  -
                </button>
                <span className="min-w-[3ch] text-center text-xs font-semibold tabular-nums">
                  {setpoint.toFixed(1)}
                </span>
                <button
                  className="flex h-5 w-5 items-center justify-center rounded-full border text-xs leading-none hover:bg-accent"
                  onClick={() =>
                    callService("input_number", "set_value", {
                      entity_id: room.setpointEntity,
                      value: Math.round((setpoint + 0.5) * 10) / 10,
                    })
                  }
                >
                  +
                </button>
              </div>
            )}
          </div>
        </div>

        {room.cameraEntity && (
          <CameraView entityId={room.cameraEntity} motionEntity={room.motionEntity} />
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t("roomCard.allLights")}</span>
          <div className="flex gap-1">
            <Button
              variant={anyOn ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setAll("on")}
            >
              ON
            </Button>
            <Button
              variant={!anyOn ? "default" : "outline"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setAll("off")}
            >
              OFF
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          {room.lights.map((light) => (
            <LightControl key={light.entityId} light={light} color={room.color} />
          ))}
        </div>

        {shutterPresent && (
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Blinds className="h-3.5 w-3.5" />
                <span>{t("rooms.blinds")}</span>
              </div>
              <span>{shutter.display}%</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() =>
                  callService("input_number", "set_value", {
                    entity_id: room.shutterEntity,
                    value: 0,
                  })
                }
              >
                <Blinds className="h-3.5 w-3.5" />
              </Button>
              <Slider min={0} max={100} step={1} className="flex-1" {...shutter.sliderProps} />
            </div>
          </div>
        )}

        {/* Auxiliary smart devices assigned to this room */}
        {(room.contactEntities?.length || room.climateEntity || room.lockEntity || room.coverEntity) && (
          <div className="space-y-2 border-t pt-2">
            {room.contactEntities && room.contactEntities.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {room.contactEntities.map((id) =>
                  entities[id] ? <BinaryChip key={id} e={entities[id]} /> : null,
                )}
              </div>
            )}
            {room.coverEntity && <CoverControl entityId={room.coverEntity} />}
            {room.climateEntity && <ClimateControl entityId={room.climateEntity} />}
            {room.lockEntity && <LockControl entityId={room.lockEntity} />}
          </div>
        )}

        {/* Real hardware, found by its Home Assistant area */}
        {real.length > 0 && (
          <div className="space-y-2 border-t pt-2">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("rooms.realDevices")}
            </p>
            {realChips.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {realChips.map((id) =>
                  entities[id] ? <BinaryChip key={id} e={entities[id]} /> : null,
                )}
              </div>
            )}
            {realSensors.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {realSensors.map((id) =>
                  entities[id] ? <SensorTile key={id} e={entities[id]} /> : null,
                )}
              </div>
            )}
            {realControls.map((id) => <EntityControl key={id} entityId={id} />)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function Rooms({ roomIds }: { roomIds?: string[] }) {
  const display = roomIds
    ? rooms.filter((r) => roomIds.includes(r.id))
    : rooms

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {display.map((room) => (
        <RoomCard key={room.id} room={room} />
      ))}
    </div>
  )
}
