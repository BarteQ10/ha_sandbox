import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useHA } from "@/hooks/useHA"
import { useToast } from "@/hooks/useToast"
import { useCustomScenes } from "@/hooks/useCustomScenes"
import { expandScene, captureScene, type Scene, type ServiceCall, type StoredScene } from "@/lib/scenes"
import { Sunrise, Clapperboard, Moon, LogOut, Sparkles, Star, Trash2, Plus } from "lucide-react"

// Entity ids of the controllable MQTT devices used by built-in scenes.
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
    id: "morning", nameKey: "scenes.morning", descKey: "scenes.morningDesc",
    icon: Sunrise, color: "#ffa726",
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
    id: "movie", nameKey: "scenes.movie", descKey: "scenes.movieDesc",
    icon: Clapperboard, color: "#a78bfa",
    steps: [
      onoff("input_boolean.wirtualne_swiatlo_salon_glowne", false),
      onoff("input_boolean.wirtualne_swiatlo_salon_led", false),
      onoff("input_boolean.wirtualne_swiatlo_salon_lampa", true),
      num("input_number.wirtualne_jasnosc_salon_lampa", 20),
      num("input_number.wirtualne_rolety_salon", 0),
    ],
  },
  {
    id: "night", nameKey: "scenes.night", descKey: "scenes.nightDesc",
    icon: Moon, color: "#4fc3f7",
    steps: [
      { allLights: "off" },
      { allBlinds: 0 },
      { call: { domain: "climate", service: "set_temperature", data: { entity_id: TRV, temperature: 18 } } },
      { call: { domain: "lock", service: "lock", data: { entity_id: LOCK } } },
    ],
  },
  {
    id: "away", nameKey: "scenes.away", descKey: "scenes.awayDesc",
    icon: LogOut, color: "#94a3b8",
    steps: [
      { allLights: "off" },
      { call: { domain: "input_select", service: "select_option", data: { entity_id: PRESENCE, option: "Poza domem" } } },
      { call: { domain: "lock", service: "lock", data: { entity_id: LOCK } } },
      { call: { domain: "cover", service: "close_cover", data: { entity_id: GATE } } },
    ],
  },
]

const CUSTOM_PALETTE = ["#34d399", "#f472b6", "#60a5fa", "#fbbf24", "#c084fc", "#fb7185"]

function SceneCard({ icon: Icon, color, name, desc, busy, onClick, onDelete }: {
  icon: React.ElementType
  color: string
  name: string
  desc?: string
  busy: boolean
  onClick: () => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={name}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick() } }}
      className={`relative cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${busy ? "opacity-60" : ""}`}
      style={{ borderTop: `3px solid ${color}` }}
    >
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute right-1 top-1 rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
          aria-label={t("scenes.delete")}
          title={t("scenes.delete")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <CardContent className="flex flex-col items-center gap-2 p-4 text-center">
        <Icon className="h-7 w-7" style={{ color }} />
        <div>
          <p className="truncate text-sm font-semibold">{name}</p>
          {desc && <p className="mt-0.5 text-[11px] text-muted-foreground">{desc}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

export function Scenes() {
  const { t } = useTranslation()
  const { entities, callService } = useHA()
  const { toast } = useToast()
  const { scenes: custom, add, remove } = useCustomScenes()
  const [busy, setBusy] = useState<string | null>(null)
  const [newName, setNewName] = useState("")

  const run = async (id: string, calls: ServiceCall[], name: string) => {
    setBusy(id)
    await Promise.all(calls.map((c) => callService(c.domain, c.service, c.data)))
    setBusy(null)
    toast(t("scenes.activated", { name, count: calls.length }), "success")
  }

  const saveCurrent = () => {
    const name = newName.trim()
    if (!name) return
    const steps = captureScene(entities)
    const scene: StoredScene = {
      id: `c_${Date.now()}`,
      name,
      color: CUSTOM_PALETTE[custom.length % CUSTOM_PALETTE.length],
      steps,
    }
    add(scene)
    setNewName("")
    toast(t("scenes.saved", { name, count: steps.length }), "success")
  }

  return (
    <div className="space-y-4">
      {/* Built-in scenes */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold sm:text-lg">{t("scenes.title")}</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {SCENES.map((s) => (
            <SceneCard
              key={s.id}
              icon={s.icon}
              color={s.color}
              name={t(s.nameKey)}
              desc={t(s.descKey)}
              busy={busy === s.id}
              onClick={() => run(s.id, expandScene(s.steps, entities), t(s.nameKey))}
            />
          ))}
        </div>
      </div>

      {/* Custom scenes */}
      <div className="space-y-2 border-t pt-3">
        <h3 className="text-sm font-semibold">{t("scenes.custom")}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {custom.map((s) => (
            <SceneCard
              key={s.id}
              icon={Star}
              color={s.color}
              name={s.name}
              busy={busy === s.id}
              onClick={() => run(s.id, s.steps, s.name)}
              onDelete={() => { remove(s.id); toast(t("scenes.deleted"), "default") }}
            />
          ))}

          {/* Capture-current-state card */}
          <Card className="flex flex-col justify-center gap-2 border-dashed p-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveCurrent() }}
              placeholder={t("scenes.newName")}
              className="w-full rounded border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("scenes.newName")}
            />
            <Button variant="outline" size="sm" disabled={!newName.trim()} onClick={saveCurrent}>
              <Plus className="mr-1 h-4 w-4" />{t("scenes.save")}
            </Button>
          </Card>
        </div>
        <p className="text-[10px] text-muted-foreground">{t("scenes.saveHint")}</p>
      </div>
    </div>
  )
}
