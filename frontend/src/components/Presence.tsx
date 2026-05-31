import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatCard } from "@/components/StatCard"
import { useEntityNum } from "@/hooks/useHA"
import { Home, Plane, Palmtree, Sun, Bell, AlertTriangle } from "lucide-react"

// ── helpers ───────────────────────────────────────────────────────────────────

const MODE_DEFS = [
  { icon: Home,     labelKey: "presence.modeHome",     color: "text-green-500",  bg: "bg-green-500/10 border-green-500/40" },
  { icon: Plane,    labelKey: "presence.modeAway",     color: "text-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/40" },
  { icon: Palmtree, labelKey: "presence.modeVacation", color: "text-blue-500",   bg: "bg-blue-500/10 border-blue-500/40" },
]

function ctToKelvin(k: number) {
  if (k <= 2700) return { label: "Warm", style: "#f97316" }
  if (k >= 6000) return { label: "Cool", style: "#93c5fd" }
  return { label: "Neutral", style: "#fbbf24" }
}

// ── component ─────────────────────────────────────────────────────────────────

export function Presence() {
  const { t } = useTranslation()

  const presenceMode  = useEntityNum("sensor.ems_presence_mode", 0)
  const brightness    = useEntityNum("sensor.ems_light_brightness", 0)
  const colorTempK    = useEntityNum("sensor.ems_light_color_temp_k", 2700)
  const lightLoadW    = useEntityNum("sensor.ems_light_load_w", 0)
  const standbyW      = useEntityNum("sensor.ems_standby_load_w", 0)
  const windowAway    = useEntityNum("sensor.ems_rule_window_away", 0)
  const laundryDone   = useEntityNum("sensor.ems_rule_laundry_done", 0)

  const modeIdx = Math.min(Math.max(Math.round(presenceMode), 0), 2)
  const mode = MODE_DEFS[modeIdx]
  const ModeIcon = mode.icon
  const ct = ctToKelvin(colorTempK)

  const hasRuleAlerts = windowAway > 0 || laundryDone > 0

  return (
    <div className="space-y-3 sm:space-y-4">
      <h2 className="text-base font-semibold sm:text-lg">{t("presence.title")}</h2>

      {/* Current presence mode */}
      <Card className={`border ${mode.bg}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <ModeIcon className={`h-8 w-8 ${mode.color}`} />
            <div>
              <p className={`text-lg font-bold ${mode.color}`}>{t(mode.labelKey)}</p>
              <p className="text-xs text-muted-foreground">{t("presence.modeHint")}</p>
            </div>
            <Badge variant="outline" className="ml-auto font-mono text-xs">
              {t("presence.register")} 19 = {modeIdx}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Circadian lighting */}
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
          color={ct.style}
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

      {/* Standby */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{t("presence.standbyLoad")}</p>
            <p className="text-sm font-semibold">{Math.round(standbyW)} W</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{t("presence.standbyHint")}</p>
        </CardContent>
      </Card>

      {/* Rule alerts */}
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

      {/* Info */}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p>{t("presence.info1")}</p>
          <p>{t("presence.info2")}</p>
        </CardContent>
      </Card>
    </div>
  )
}
