import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useEntity, useHA } from "@/hooks/useHA"
import { useCommittedSlider } from "@/hooks/useCommittedSlider"
import {
  Lock, Unlock, Thermometer, Droplets, Flame, Waves, DoorOpen, Wind,
  Activity, AlertTriangle, ArrowUp, ArrowDown, Square, Plus, Minus, Power,
  DoorClosed, AppWindow, Fan, Bot, Play, Pause, RotateCcw, Battery, Cloud, Gauge,
} from "lucide-react"
import type { HassEntity } from "home-assistant-js-websocket"

// Shared smart-device control components, used both by the Devices tab and by
// individual room cards (Rooms.tsx) so per-room and house-wide layouts share
// exactly the same UI.

// HA prefixes MQTT entity friendly names with the device name ("EMS Simulator
// Living Window"), which overflows the compact chips/cards. Strip that prefix
// for display; the full name stays available via a `title` tooltip.
function displayName(n: string): string {
  return n.replace(/^EMS Simulator\s+/i, "")
}

// ─── cover (gate) ─────────────────────────────────────────────────────────────

export function CoverControl({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const { callService } = useHA()
  const e = useEntity(entityId)
  const state = e?.state ?? "unknown"
  const name = (e?.attributes?.friendly_name as string) ?? entityId
  const pos = (e?.attributes?.current_position as number) ?? (state === "open" ? 100 : 0)

  const slider = useCommittedSlider(pos, (v) =>
    callService("cover", "set_cover_position", { entity_id: entityId, position: v }),
  )
  const cmd = (service: string) => callService("cover", service, { entity_id: entityId })

  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <DoorOpen className="h-4 w-4 text-muted-foreground" />
          <span title={name} className="truncate text-sm font-medium">{displayName(name)}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{slider.display}%</span>
        </div>
        <Slider min={0} max={100} step={1} {...slider.sliderProps} />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => cmd("open_cover")}>
            <ArrowUp className="mr-1 h-4 w-4" />{t("devices.open")}
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => cmd("stop_cover")}>
            <Square className="mr-1 h-4 w-4" />{t("devices.stop")}
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => cmd("close_cover")}>
            <ArrowDown className="mr-1 h-4 w-4" />{t("devices.close")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── lock ─────────────────────────────────────────────────────────────────────

export function LockControl({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const { callService } = useHA()
  const e = useEntity(entityId)
  const locked = (e?.state ?? "locked") === "locked"
  const name = (e?.attributes?.friendly_name as string) ?? entityId

  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        {locked
          ? <Lock className="h-5 w-5 text-green-500" />
          : <Unlock className="h-5 w-5 text-yellow-500" />}
        <div className="min-w-0 flex-1">
          <p title={name} className="truncate text-sm font-medium">{displayName(name)}</p>
          <p className="text-xs text-muted-foreground">
            {locked ? t("devices.locked") : t("devices.unlocked")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            callService("lock", locked ? "unlock" : "lock", { entity_id: entityId })
          }
        >
          {locked ? t("devices.unlock") : t("devices.lock")}
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── climate (thermostat / TRV) ───────────────────────────────────────────────

export function ClimateControl({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const { callService } = useHA()
  const e = useEntity(entityId)
  const a = (e?.attributes ?? {}) as Record<string, unknown>
  const mode = e?.state ?? "off"
  const name = (a.friendly_name as string) ?? entityId
  const target = (a.temperature as number) ?? 20
  const current = a.current_temperature as number | undefined
  const minT = (a.min_temp as number) ?? 7
  const maxT = (a.max_temp as number) ?? 30
  const heating = mode === "heat"

  const setTemp = (v: number) =>
    callService("climate", "set_temperature", {
      entity_id: entityId,
      temperature: Math.min(maxT, Math.max(minT, Math.round(v * 2) / 2)),
    })

  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Thermometer className="h-4 w-4 text-muted-foreground" />
          <span title={name} className="truncate text-sm font-medium">{displayName(name)}</span>
          {current !== undefined && (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {current.toFixed(1)}°C
            </span>
          )}
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="icon" className="h-9 w-9"
            onClick={() => setTemp(target - 0.5)} aria-label={t("devices.tempDown")}>
            <Minus className="h-4 w-4" />
          </Button>
          <div className="min-w-[5rem] text-center">
            <div className="text-2xl font-bold tabular-nums">{target.toFixed(1)}°</div>
            <div className="text-[10px] text-muted-foreground">{t("devices.target")}</div>
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9"
            onClick={() => setTemp(target + 0.5)} aria-label={t("devices.tempUp")}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant={heating ? "default" : "outline"}
          size="sm"
          className="w-full"
          onClick={() =>
            callService("climate", "set_hvac_mode", {
              entity_id: entityId, hvac_mode: heating ? "off" : "heat",
            })
          }
        >
          <Power className="mr-1 h-4 w-4" />
          {heating ? t("devices.heatOn") : t("devices.heatOff")}
        </Button>
      </CardContent>
    </Card>
  )
}

// ─── fan ──────────────────────────────────────────────────────────────────────

export function FanControl({ entityId }: { entityId: string }) {
  const { callService } = useHA()
  const e = useEntity(entityId)
  const on = e?.state === "on"
  const name = (e?.attributes?.friendly_name as string) ?? entityId
  const pct = (e?.attributes?.percentage as number) ?? 0

  const slider = useCommittedSlider(pct, (v) =>
    callService("fan", "set_percentage", { entity_id: entityId, percentage: v }),
  )

  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Fan className={`h-4 w-4 ${on ? "text-sky-500" : "text-muted-foreground"}`} />
          <span title={name} className="truncate text-sm font-medium">{displayName(name)}</span>
          <Switch
            className="ml-auto"
            checked={on}
            onCheckedChange={() => callService("fan", on ? "turn_off" : "turn_on", { entity_id: entityId })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Slider min={0} max={100} step={1} className="flex-1" {...slider.sliderProps} />
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {slider.display}%
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── robot vacuum ─────────────────────────────────────────────────────────────

const VAC_STATES = new Set(["cleaning", "docked", "paused", "idle", "returning", "error"])

export function VacuumControl({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const { entities, callService } = useHA()
  const e = useEntity(entityId)
  const state = e?.state ?? "unknown"
  const name = (e?.attributes?.friendly_name as string) ?? entityId
  // Prefer the vacuum's own battery_level; fall back to a related battery sensor
  // (MQTT state-schema vacuums don't always expose battery_level as an attribute).
  const battAttr = e?.attributes?.battery_level as number | undefined
  const battSensor = Object.values(entities).find((s) =>
    s.entity_id.startsWith("sensor.") &&
    s.attributes.device_class === "battery" &&
    s.entity_id.includes("vacuum"))
  const battRaw = battAttr ?? (battSensor ? Number(battSensor.state) : undefined)
  const batt = battRaw !== undefined && !Number.isNaN(battRaw) ? battRaw : undefined
  const cleaning = state === "cleaning"
  const cmd = (service: string) => callService("vacuum", service, { entity_id: entityId })
  const label = VAC_STATES.has(state) ? t(`devices.vac.${state}`) : state

  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Bot className={`h-4 w-4 ${cleaning ? "text-green-500" : "text-muted-foreground"}`} />
          <span title={name} className="truncate text-sm font-medium">{displayName(name)}</span>
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            {batt !== undefined && (<><Battery className="h-3.5 w-3.5" />{Math.round(batt)}%</>)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => cmd("start")}>
            <Play className="mr-1 h-4 w-4" />{t("devices.vacStart")}
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => cmd("pause")}>
            <Pause className="mr-1 h-4 w-4" />{t("devices.vacPause")}
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => cmd("return_to_base")}>
            <RotateCcw className="mr-1 h-4 w-4" />{t("devices.vacReturn")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── binary sensor status chip ────────────────────────────────────────────────

const PROBLEM_CLASSES = new Set(["smoke", "carbon_monoxide", "gas", "moisture"])
const OPENING_CLASSES = new Set(["window", "door", "opening", "garage_door"])

const BS_ICON: Record<string, React.ElementType> = {
  smoke: AlertTriangle, carbon_monoxide: Wind, gas: Flame, moisture: Droplets,
  window: AppWindow, door: DoorOpen, motion: Activity,
}

export function BinaryChip({ e }: { e: HassEntity }) {
  const on = e.state === "on"
  const dc = (e.attributes.device_class as string) ?? ""
  const name = (e.attributes.friendly_name as string) ?? e.entity_id
  const Icon = on ? (BS_ICON[dc] ?? Activity) : (dc === "door" ? DoorClosed : (BS_ICON[dc] ?? Activity))

  const color = !on
    ? "text-muted-foreground"
    : PROBLEM_CLASSES.has(dc)
      ? "text-red-500"
      : OPENING_CLASSES.has(dc)
        ? "text-yellow-500"
        : "text-blue-400"

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-2">
      <Icon className={`h-4 w-4 shrink-0 ${color}`} />
      <span title={name} className="min-w-0 flex-1 truncate text-xs">{displayName(name)}</span>
      <span className={`text-[10px] font-medium ${color}`}>{on ? "●" : "○"}</span>
    </div>
  )
}

// ─── environment sensor tile (humidity / meters) ──────────────────────────────

export const ENV_CLASSES = new Set([
  "humidity", "water", "gas", "carbon_dioxide", "pm25", "aqi",
])

const SENSOR_ICON: Record<string, React.ElementType> = {
  humidity: Droplets, water: Waves, gas: Flame, temperature: Thermometer,
  carbon_dioxide: Wind, pm25: Cloud, aqi: Gauge,
}

export function SensorTile({ e }: { e: HassEntity }) {
  const dc = (e.attributes.device_class as string) ?? ""
  const name = (e.attributes.friendly_name as string) ?? e.entity_id
  const unit = (e.attributes.unit_of_measurement as string) ?? ""
  const Icon = SENSOR_ICON[dc] ?? Activity
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span title={name} className="truncate">{displayName(name)}</span>
      </div>
      <div className="text-lg font-bold tabular-nums">
        {e.state}<span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}
