import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { useEntity, useHA, useEntitiesByDomain } from "@/hooks/useHA"
import { useCommittedSlider } from "@/hooks/useCommittedSlider"
import {
  Lock, Unlock, Thermometer, Droplets, Flame, Waves, DoorOpen, Wind,
  Activity, AlertTriangle, ArrowUp, ArrowDown, Square, Plus, Minus, Power,
  DoorClosed, AppWindow,
} from "lucide-react"
import type { HassEntity } from "home-assistant-js-websocket"

// ─── cover (gate) ─────────────────────────────────────────────────────────────

function CoverControl({ entityId }: { entityId: string }) {
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
          <span className="truncate text-sm font-medium">{name}</span>
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

function LockControl({ entityId }: { entityId: string }) {
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
          <p className="truncate text-sm font-medium">{name}</p>
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

function ClimateControl({ entityId }: { entityId: string }) {
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
          <span className="truncate text-sm font-medium">{name}</span>
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

// ─── binary sensor status chip ────────────────────────────────────────────────

const PROBLEM_CLASSES = new Set(["smoke", "carbon_monoxide", "gas", "moisture"])
const OPENING_CLASSES = new Set(["window", "door", "opening", "garage_door"])

const BS_ICON: Record<string, React.ElementType> = {
  smoke: AlertTriangle, carbon_monoxide: Wind, gas: Flame, moisture: Droplets,
  window: AppWindow, door: DoorOpen, motion: Activity,
}

function BinaryChip({ e }: { e: HassEntity }) {
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
      <span className="min-w-0 flex-1 truncate text-xs">{name}</span>
      <span className={`text-[10px] font-medium ${color}`}>
        {on ? "●" : "○"}
      </span>
    </div>
  )
}

// ─── environment sensor tile (humidity / meters) ──────────────────────────────

const SENSOR_ICON: Record<string, React.ElementType> = {
  humidity: Droplets, water: Waves, gas: Flame, temperature: Thermometer,
}
const ENV_CLASSES = new Set(["humidity", "water", "gas"])

function SensorTile({ e }: { e: HassEntity }) {
  const dc = (e.attributes.device_class as string) ?? ""
  const name = (e.attributes.friendly_name as string) ?? e.entity_id
  const unit = (e.attributes.unit_of_measurement as string) ?? ""
  const Icon = SENSOR_ICON[dc] ?? Activity
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{name}</span>
      </div>
      <div className="text-lg font-bold tabular-nums">
        {e.state}<span className="ml-1 text-[10px] font-normal text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}

// ─── container ────────────────────────────────────────────────────────────────

function Section({ title, count, children }: {
  title: string; count: number; children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  )
}

export function Devices() {
  const { t } = useTranslation()
  const { entities } = useHA()
  const covers   = useEntitiesByDomain("cover")
  const locks    = useEntitiesByDomain("lock")
  const climates = useEntitiesByDomain("climate")

  const binaries = Object.values(entities)
    .filter((e) => e.entity_id.startsWith("binary_sensor."))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
  const envSensors = Object.values(entities)
    .filter((e) => e.entity_id.startsWith("sensor.") &&
      ENV_CLASSES.has((e.attributes.device_class as string) ?? ""))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id))

  const total = covers.length + locks.length + climates.length + binaries.length + envSensors.length

  if (total === 0) {
    return (
      <Card>
        <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
          {t("devices.empty")}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Section title={t("devices.controllable")} count={covers.length + locks.length + climates.length}>
        <div className="grid gap-3 lg:grid-cols-2">
          {covers.map((id) => <CoverControl key={id} entityId={id} />)}
          {climates.map((id) => <ClimateControl key={id} entityId={id} />)}
          {locks.map((id) => <LockControl key={id} entityId={id} />)}
        </div>
      </Section>

      <Section title={t("devices.contacts")} count={binaries.length}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {binaries.map((e) => <BinaryChip key={e.entity_id} e={e} />)}
        </div>
      </Section>

      <Section title={t("devices.environment")} count={envSensors.length}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {envSensors.map((e) => <SensorTile key={e.entity_id} e={e} />)}
        </div>
      </Section>

      <p className="text-center text-[10px] text-muted-foreground">{t("devices.note")}</p>
    </div>
  )
}
