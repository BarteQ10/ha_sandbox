import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { StatCard } from "@/components/StatCard"
import { useEntityNum, useEntityState, useHA } from "@/hooks/useHA"
import {
  Home, Plane, Palmtree, Sun, Bell, AlertTriangle,
  Eye, EyeOff, Tv, Play, Pause, StopCircle,
} from "lucide-react"

// ── helpers ───────────────────────────────────────────────────────────────────

const MODE_DEFS = [
  { icon: Home,     labelKey: "presence.modeHome",     color: "text-green-500",  bg: "bg-green-500/10 border-green-500/40",  value: "W domu" },
  { icon: Plane,    labelKey: "presence.modeAway",     color: "text-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/40", value: "Poza domem" },
  { icon: Palmtree, labelKey: "presence.modeVacation", color: "text-blue-500",   bg: "bg-blue-500/10 border-blue-500/40",    value: "Urlop" },
]

function ctColor(k: number) {
  if (k <= 2700) return "#f97316"
  if (k >= 6000) return "#93c5fd"
  return "#fbbf24"
}

function mediaIcon(state: string) {
  if (state === "playing") return <Play  className="h-4 w-4 text-green-400" />
  if (state === "paused")  return <Pause className="h-4 w-4 text-yellow-400" />
  return <StopCircle className="h-4 w-4 text-muted-foreground" />
}

function mediaLabel(state: string, t: (k: string) => string) {
  if (state === "playing") return t("presence.mediaPlaying")
  if (state === "paused")  return t("presence.mediaPaused")
  return t("presence.mediaIdle")
}

// ── component ─────────────────────────────────────────────────────────────────

export function Presence() {
  const { t } = useTranslation()
  const { callService } = useHA()

  // Presence mode — read from InfluxDB (integer 0/1/2)
  const presenceMode  = useEntityNum("sensor.ems_presence_mode", 0)
  // Presence mode — read from HA input_select (string) for the control
  const presenceStr   = useEntityState("input_select.ems_tryb_obecnosci", "W domu")

  // Circadian lighting (InfluxDB → slower, HA template → near-realtime)
  const brightness    = useEntityNum("sensor.ems_jasnosc_cyrkadianowa",            0)
  const colorTempK    = useEntityNum("sensor.ems_temperatura_barwowa_cyrkadianowa", 2700)
  const lightLoadW    = useEntityNum("sensor.ems_light_load_w",                     0)
  const standbyW      = useEntityNum("sensor.ems_standby_load_w",                   0)

  // Media player (HA template sensor reads from /metrics)
  const mediaState    = useEntityState("sensor.ems_tryb_mediow", "idle")

  // Motion sensors (HA template binary sensors read from /metrics)
  const motionOut     = useEntityState("binary_sensor.ems_czujnik_ruchu_zewnetrzny", "off")
  const motionIn      = useEntityState("binary_sensor.ems_czujnik_ruchu_wewnetrzny", "off")

  // Rule alerts (InfluxDB)
  const windowAway    = useEntityNum("sensor.ems_rule_window_away",  0)
  const laundryDone   = useEntityNum("sensor.ems_rule_laundry_done", 0)

  const modeIdx = Math.min(Math.max(Math.round(presenceMode), 0), 2)
  const mode = MODE_DEFS[modeIdx]
  const ModeIcon = mode.icon

  const hasRuleAlerts = windowAway > 0 || laundryDone > 0
  const outdoorActive = motionOut === "on"
  const indoorActive  = motionIn  === "on"

  return (
    <div className="space-y-3 sm:space-y-4">
      <h2 className="text-base font-semibold sm:text-lg">{t("presence.title")}</h2>

      {/* ── Presence mode — display + control ───────────────────────────────── */}
      <Card className={`border ${mode.bg}`}>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <ModeIcon className={`h-8 w-8 shrink-0 ${mode.color}`} />
            <div className="flex-1">
              <p className={`text-lg font-bold ${mode.color}`}>{t(mode.labelKey)}</p>
              <p className="text-xs text-muted-foreground">{t("presence.modeHint")}</p>
            </div>
            <Select
              value={presenceStr}
              onValueChange={(v) =>
                callService("input_select", "select_option", {
                  entity_id: "input_select.ems_tryb_obecnosci",
                  option: v,
                })
              }
            >
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_DEFS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{t(m.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Motion sensors ───────────────────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-muted-foreground">{t("presence.motionTitle")}</h2>
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <Card className={outdoorActive ? "border-yellow-500/60 bg-yellow-500/5" : ""}>
          <CardContent className="flex items-center gap-3 p-4">
            {outdoorActive
              ? <Eye className="h-5 w-5 shrink-0 text-yellow-400" />
              : <EyeOff className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <div>
              <p className="text-sm font-medium">{t("presence.motionOutdoor")}</p>
              <p className={`text-xs ${outdoorActive ? "text-yellow-500" : "text-muted-foreground"}`}>
                {outdoorActive ? t("presence.motionDetected") : t("presence.motionClear")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className={indoorActive ? "border-red-500/60 bg-red-500/5" : ""}>
          <CardContent className="flex items-center gap-3 p-4">
            {indoorActive
              ? <Eye className="h-5 w-5 shrink-0 text-red-400" />
              : <EyeOff className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <div>
              <p className="text-sm font-medium">{t("presence.motionIndoor")}</p>
              <p className={`text-xs ${indoorActive ? "text-red-500" : "text-muted-foreground"}`}>
                {indoorActive ? t("presence.motionDetected") : t("presence.motionClear")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Media player state ───────────────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-muted-foreground">{t("presence.mediaTitle")}</h2>
      <Card className={mediaState === "playing" ? "border-green-500/40 bg-green-500/5" : ""}>
        <CardContent className="flex items-center gap-3 p-4">
          <Tv className="h-5 w-5 shrink-0 text-muted-foreground" />
          {mediaIcon(mediaState)}
          <p className="text-sm font-medium">{mediaLabel(mediaState, t)}</p>
          {mediaState === "playing" && (
            <span className="ml-auto animate-pulse text-xs text-green-400">● LIVE</span>
          )}
        </CardContent>
      </Card>

      {/* ── Circadian lighting ───────────────────────────────────────────────── */}
      <h2 className="text-sm font-semibold text-muted-foreground">{t("presence.lightingTitle")}</h2>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard
          label={t("presence.brightness")}
          value={Math.round(brightness).toString()}
          unit="%"
          color="#fbbf24"
          icon={Sun}
        />
        <StatCard
          label={t("presence.colorTemp")}
          value={Math.round(colorTempK).toString()}
          unit="K"
          color={ctColor(colorTempK)}
          icon={Sun}
        />
        <StatCard
          label={t("presence.lightLoad")}
          value={Math.round(lightLoadW).toString()}
          unit="W"
          color="#a78bfa"
          icon={Sun}
        />
      </div>

      {/* ── Standby ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{t("presence.standbyLoad")}</p>
            <p className="text-sm font-semibold">{Math.round(standbyW)} W</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("presence.standbyHint")}</p>
        </CardContent>
      </Card>

      {/* ── Rule alerts ─────────────────────────────────────────────────────── */}
      {hasRuleAlerts && (
        <>
          <h2 className="text-sm font-semibold text-muted-foreground">{t("presence.rulesTitle")}</h2>
          <div className="space-y-2">
            {windowAway > 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-yellow-500/60 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t("presence.ruleWindowAway")}
              </div>
            )}
            {laundryDone > 0 && (
              <div className="flex items-center gap-3 rounded-lg border border-blue-500/60 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
                <Bell className="h-4 w-4 shrink-0" />
                {t("presence.ruleLaundryDone")}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
