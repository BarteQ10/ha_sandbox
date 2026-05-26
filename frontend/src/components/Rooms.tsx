import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { useEntityState, useEntityNum, useHA } from "@/hooks/useHA"
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
  name: string
  brightnessEntity?: string
  colorTempEntity?: string
  rgbEntities?: RgbChannels
}

interface RoomConfig {
  id: string
  nameKey: string
  icon: React.ElementType
  color: string
  tempEntity: string
  lights: LightConfig[]
  shutterEntity?: string
  humidityEntity?: string
}

const rooms: RoomConfig[] = [
  {
    id: "salon",
    nameKey: "rooms.salon",
    icon: Sofa,
    color: "#ffa726",
    tempEntity: "input_number.wirtualna_temp_salon",
    lights: [
      { entityId: "input_boolean.wirtualne_swiatlo_salon_glowne", name: "Główne" },
      {
        entityId: "input_boolean.wirtualne_swiatlo_salon_lampa",
        name: "Lampa stojąca",
        brightnessEntity: "input_number.wirtualne_jasnosc_salon_lampa",
        colorTempEntity: "input_number.wirtualne_barwa_salon_lampa",
      },
      {
        entityId: "input_boolean.wirtualne_swiatlo_salon_led",
        name: "LED",
        rgbEntities: {
          r: "input_number.wirtualne_rgb_salon_led_r",
          g: "input_number.wirtualne_rgb_salon_led_g",
          b: "input_number.wirtualne_rgb_salon_led_b",
        },
      },
    ],
    shutterEntity: "input_number.wirtualne_rolety_salon",
  },
  {
    id: "kuchnia",
    nameKey: "rooms.kitchen",
    icon: CookingPot,
    color: "#66bb6a",
    tempEntity: "input_number.wirtualna_temp_kuchnia",
    lights: [
      { entityId: "input_boolean.wirtualne_swiatlo_kuchnia_glowne", name: "Główne" },
      {
        entityId: "input_boolean.wirtualne_swiatlo_kuchnia_wyspa",
        name: "Wyspa",
        brightnessEntity: "input_number.wirtualne_jasnosc_kuchnia_wyspa",
      },
      {
        entityId: "input_boolean.wirtualne_swiatlo_kuchnia_led",
        name: "LED",
        rgbEntities: {
          r: "input_number.wirtualne_rgb_kuchnia_led_r",
          g: "input_number.wirtualne_rgb_kuchnia_led_g",
          b: "input_number.wirtualne_rgb_kuchnia_led_b",
        },
      },
    ],
    shutterEntity: "input_number.wirtualne_rolety_kuchnia",
  },
  {
    id: "sypialnia",
    nameKey: "rooms.bedroom",
    icon: Bed,
    color: "#4fc3f7",
    tempEntity: "input_number.wirtualna_temp_sypialnia",
    lights: [
      {
        entityId: "input_boolean.wirtualne_swiatlo_sypialnia_glowne",
        name: "Główne",
        brightnessEntity: "input_number.wirtualne_jasnosc_sypialnia_glowne",
      },
      {
        entityId: "input_boolean.wirtualne_swiatlo_sypialnia_lampka1",
        name: "Lampka 1",
        brightnessEntity: "input_number.wirtualne_jasnosc_sypialnia_lampka1",
        colorTempEntity: "input_number.wirtualne_barwa_sypialnia_lampka1",
      },
      {
        entityId: "input_boolean.wirtualne_swiatlo_sypialnia_lampka2",
        name: "Lampka 2",
        brightnessEntity: "input_number.wirtualne_jasnosc_sypialnia_lampka2",
        colorTempEntity: "input_number.wirtualne_barwa_sypialnia_lampka2",
      },
      { entityId: "input_boolean.wirtualne_swiatlo_sypialnia_kinkiet", name: "Kinkiet" },
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
      { entityId: "input_boolean.wirtualne_swiatlo_lazienka_glowne", name: "Główne" },
      {
        entityId: "input_boolean.wirtualne_swiatlo_lazienka_lustro",
        name: "Lustro LED",
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
      { entityId: "input_boolean.wirtualne_swiatlo_ogrod_glowne", name: "Główne" },
      { entityId: "input_boolean.wirtualne_swiatlo_ogrod_solarne", name: "Solarne" },
    ],
  },
]

function RoomCard({ room }: { room: RoomConfig }) {
  const { t } = useTranslation()
  const { callService } = useHA()

  const temp = useEntityNum(room.tempEntity, 21)
  const shutterPos = room.shutterEntity ? useEntityNum(room.shutterEntity, 100) : null
  const humidity = room.humidityEntity ? useEntityNum(room.humidityEntity, 50) : null

  const RoomIcon = room.icon
  const lightStates = room.lights.map((l) => useEntityState(l.entityId) === "on")
  const anyOn = lightStates.some(Boolean)

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
          <div className="flex items-center gap-1 text-lg font-bold">
            <Thermometer className="h-4 w-4 text-muted-foreground" />
            {temp.toFixed(1)}°
            {humidity !== null && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                <Droplets className="inline h-3 w-3" /> {humidity}%
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Wszystkie światła</span>
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
          {room.lights.map((light) => {
            const isOn = useEntityState(light.entityId) === "on"
            const brightness = light.brightnessEntity
              ? useEntityNum(light.brightnessEntity, 100)
              : null
            const colorTemp = light.colorTempEntity
              ? useEntityNum(light.colorTempEntity, 4000)
              : null
            const r = light.rgbEntities ? useEntityNum(light.rgbEntities.r, 255) : null
            const g = light.rgbEntities ? useEntityNum(light.rgbEntities.g, 255) : null
            const b = light.rgbEntities ? useEntityNum(light.rgbEntities.b, 255) : null

            return (
              <div
                key={light.entityId}
                className="rounded-md border p-2.5 space-y-2"
                style={{
                  borderColor: isOn ? room.color : "var(--border)",
                  backgroundColor: isOn ? `${room.color}12` : "transparent",
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs">
                    <Lightbulb
                      className="h-3.5 w-3.5 shrink-0"
                      style={{ color: isOn ? room.color : undefined }}
                      fill={isOn ? room.color : "none"}
                    />
                    {light.name}
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

                {isOn && brightness !== null && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-6">Jas</span>
                    <Slider
                      key={light.brightnessEntity}
                      value={[brightness]}
                      min={0}
                      max={100}
                      step={1}
                      className="flex-1"
                      onValueChange={([v]) =>
                        callService("input_number", "set_value", {
                          entity_id: light.brightnessEntity,
                          value: v,
                        })
                      }
                    />
                    <span className="text-[10px] text-muted-foreground w-6 text-right">
                      {brightness}%
                    </span>
                  </div>
                )}

                {isOn && r !== null && g !== null && b !== null && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: `rgb(${r},${g},${b})` }}
                      />
                      <span className="text-[10px] text-muted-foreground">RGB</span>
                    </div>
                    {([
                      { ch: "r", label: "R", val: r, entity: light.rgbEntities!.r },
                      { ch: "g", label: "G", val: g, entity: light.rgbEntities!.g },
                      { ch: "b", label: "B", val: b, entity: light.rgbEntities!.b },
                    ] as const).map(({ ch, label, val, entity }) => (
                      <div className="flex items-center gap-2" key={ch}>
                        <span
                          className="text-[10px] font-bold w-3"
                          style={{ color: ch === "r" ? "#ef4444" : ch === "g" ? "#22c55e" : "#3b82f6" }}
                        >
                          {label}
                        </span>
                        <Slider
                          key={entity}
                          color={`rgb(${r},${g},${b})`}
                          value={[val]}
                          min={0}
                          max={255}
                          step={1}
                          className="flex-1"
                          onValueChange={([v]) =>
                            callService("input_number", "set_value", {
                              entity_id: entity,
                              value: v,
                            })
                          }
                        />
                        <span className="text-[10px] text-muted-foreground w-6 text-right">{val}</span>
                      </div>
                    ))}
                  </div>
                )}

                {isOn && colorTemp !== null && (
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: kelvinToRgb(colorTemp) }}
                    />
                    <Slider
                      key={light.colorTempEntity}
                      color={kelvinToRgb(colorTemp)}
                      value={[colorTemp]}
                      min={2700}
                      max={6500}
                      step={100}
                      className="flex-1"
                      onValueChange={([v]) =>
                        callService("input_number", "set_value", {
                          entity_id: light.colorTempEntity,
                          value: v,
                        })
                      }
                    />
                    <span className="text-[10px] text-muted-foreground w-10 text-right">
                      {colorTemp}K
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {shutterPos !== null && (
          <div className="space-y-1 pt-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Blinds className="h-3.5 w-3.5" />
                <span>{t("rooms.blinds")}</span>
              </div>
              <span>{shutterPos}%</span>
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
              <Slider
                value={[shutterPos]}
                min={0}
                max={100}
                step={1}
                className="flex-1"
                onValueChange={([v]) =>
                  callService("input_number", "set_value", {
                    entity_id: room.shutterEntity,
                    value: v,
                  })
                }
              />
            </div>
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
