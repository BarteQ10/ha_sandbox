import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { useHA } from "@/hooks/useHA"
import { useToast } from "@/hooks/useToast"
import { expandScene, type Scene } from "@/lib/scenes"
import { Sunrise, Clapperboard, Moon, LogOut, Sparkles } from "lucide-react"

// Entity ids of the controllable MQTT devices used by scenes.
const TRV  = "climate.ems_simulator_living_room_trv"
const LOCK = "lock.ems_simulator_entrance_lock"
const GATE = "cover.ems_simulator_driveway_gate"
const PRESENCE = "input_select.ems_tryb_obecnosci"

const num = (entity_id: string, value: number) =>
  ({ call: { domain: "input_number", service: "set_value", data: { entity_id, value } } } as const)
const onoff = (entity_id: string, on: boolean) =>
  ({ call: { domain: "input_boolean", service: on ? "turn_on" : "turn_off", data: { entity_id } } } as const)

const SCENES: Array<Scene & { icon: React.ElementType; color: string }> = [
  {
    id: "morning",
    nameKey: "scenes.morning",
    descKey: "scenes.morningDesc",
    icon: Sunrise,
    color: "#ffa726",
    steps: [
      { allBlinds: 100 },
      { call: { domain: "climate", service: "set_temperature", data: { entity_id: TRV, temperature: 21 } } },
      { call: { domain: "climate", service: "set_hvac_mode", data: { entity_id: TRV, hvac_mode: "heat" } } },
      onoff("input_boolean.wirtualne_swiatlo_salon_glowne", true),
      onoff("input_boolean.wirtualne_swiatlo_kuchnia_glowne", true),
      { call: { domain: "input_select", service: "select_option", data: { entity_id: PRESENCE, option: "W domu" } } },
    ],
  },
  {
    id: "movie",
    nameKey: "scenes.movie",
    descKey: "scenes.movieDesc",
    icon: Clapperboard,
    color: "#a78bfa",
    steps: [
      onoff("input_boolean.wirtualne_swiatlo_salon_glowne", false),
      onoff("input_boolean.wirtualne_swiatlo_salon_led", false),
      onoff("input_boolean.wirtualne_swiatlo_salon_lampa", true),
      num("input_number.wirtualne_jasnosc_salon_lampa", 20),
      num("input_number.wirtualne_rolety_salon", 0),
    ],
  },
  {
    id: "night",
    nameKey: "scenes.night",
    descKey: "scenes.nightDesc",
    icon: Moon,
    color: "#4fc3f7",
    steps: [
      { allLights: "off" },
      { allBlinds: 0 },
      { call: { domain: "climate", service: "set_temperature", data: { entity_id: TRV, temperature: 18 } } },
      { call: { domain: "lock", service: "lock", data: { entity_id: LOCK } } },
    ],
  },
  {
    id: "away",
    nameKey: "scenes.away",
    descKey: "scenes.awayDesc",
    icon: LogOut,
    color: "#94a3b8",
    steps: [
      { allLights: "off" },
      { call: { domain: "input_select", service: "select_option", data: { entity_id: PRESENCE, option: "Poza domem" } } },
      { call: { domain: "lock", service: "lock", data: { entity_id: LOCK } } },
      { call: { domain: "cover", service: "close_cover", data: { entity_id: GATE } } },
    ],
  },
]

export function Scenes() {
  const { t } = useTranslation()
  const { entities, callService } = useHA()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const activate = async (scene: Scene & { icon: React.ElementType }) => {
    setBusy(scene.id)
    const calls = expandScene(scene.steps, entities)
    await Promise.all(calls.map((c) => callService(c.domain, c.service, c.data)))
    setBusy(null)
    toast(t("scenes.activated", { name: t(scene.nameKey), count: calls.length }), "success")
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold sm:text-lg">{t("scenes.title")}</h2>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {SCENES.map((scene) => {
          const Icon = scene.icon
          return (
            <Card
              key={scene.id}
              role="button"
              tabIndex={0}
              aria-label={t(scene.nameKey)}
              onClick={() => activate(scene)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(scene) } }}
              className={`cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                busy === scene.id ? "opacity-60" : ""
              }`}
              style={{ borderTop: `3px solid ${scene.color}` }}
            >
              <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
                <Icon className="h-7 w-7" style={{ color: scene.color }} />
                <div>
                  <p className="text-sm font-semibold">{t(scene.nameKey)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t(scene.descKey)}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <p className="text-center text-[10px] text-muted-foreground">{t("scenes.note")}</p>
    </div>
  )
}
