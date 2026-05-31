import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Zap, BatteryLow, CloudSnow, Activity, ShieldAlert, Bell, Home } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEntityNum, useEntityState } from "@/hooks/useHA"

interface Alert {
  key: string
  icon: React.ReactNode
  message: string
  variant: "destructive" | "warning" | "info"
  dismissable: boolean  // destructive alerts (blackout, SoC critical) cannot be dismissed
}

// ── dismiss/snooze state stored in localStorage ──────────────────────────────

type HiddenMap = Record<string, number>  // key → timestamp (ms) until hidden

function loadHiddenMap(): HiddenMap {
  try { return JSON.parse(localStorage.getItem("ems-alert-hidden") ?? "{}") }
  catch { return {} }
}

function saveHiddenMap(map: HiddenMap) {
  localStorage.setItem("ems-alert-hidden", JSON.stringify(map))
}

function useAlertActions() {
  const [hidden, setHidden] = useState<HiddenMap>(loadHiddenMap)

  const hide = useCallback((key: string, ms: number) => {
    setHidden(prev => {
      const next = { ...prev, [key]: Date.now() + ms }
      saveHiddenMap(next)
      return next
    })
  }, [])

  const isHidden = useCallback((key: string) => {
    const expiry = hidden[key]
    return !!expiry && Date.now() < expiry
  }, [hidden])

  const dismiss = useCallback((key: string) => hide(key, 60 * 60 * 1000), [hide])   // 1 h
  const snooze  = useCallback((key: string) => hide(key, 15 * 60 * 1000), [hide])   // 15 min

  return { dismiss, snooze, isHidden }
}

// ── alert definitions ─────────────────────────────────────────────────────────

function useAlerts(): Alert[] {
  const { t } = useTranslation()

  const gridStatus    = useEntityNum("sensor.ems_status_sieci", 0)
  const soc           = useEntityNum("sensor.sztuczny_stan_baterii_soc", 50)
  const price         = useEntityNum("sensor.ems_biezaca_cena_energii", 30)
  const anomaly       = useEntityNum("sensor.ems_symuluj_awarie_api", 0)
  const storm         = useEntityNum("sensor.ems_storm_safeguard", 0)
  const curtail       = useEntityNum("sensor.ems_ograniczenie_pv", 0)
  const pvW           = useEntityNum("sensor.sztuczna_produkcja_pv", 0)
  const cloudStr      = useEntityState("sensor.cloud_cover", "0")
  const cloud         = Number(cloudStr)
  const windowAway    = useEntityNum("sensor.ems_rule_window_away", 0)
  const laundryDone   = useEntityNum("sensor.ems_rule_laundry_done", 0)
  const presenceMode  = useEntityNum("sensor.ems_presence_mode", 0)

  return useMemo(() => {
    const alerts: Alert[] = []

    if (gridStatus === 1) {
      alerts.push({ key: "blackout", icon: <Zap className="h-4 w-4" />,
        message: t("alerts.blackout"), variant: "destructive", dismissable: false })
    }
    if (soc <= 10) {
      alerts.push({ key: "soc-critical", icon: <BatteryLow className="h-4 w-4" />,
        message: t("alerts.socCritical", { soc: Math.round(soc) }), variant: "destructive", dismissable: false })
    } else if (soc <= 20) {
      alerts.push({ key: "soc-low", icon: <BatteryLow className="h-4 w-4" />,
        message: t("alerts.socLow", { soc: Math.round(soc) }), variant: "warning", dismissable: true })
    }
    if (price < 0) {
      alerts.push({ key: "negative-price", icon: <AlertTriangle className="h-4 w-4" />,
        message: t("alerts.negativePrice", { price: price.toFixed(1) }), variant: "info", dismissable: true })
    }
    if (anomaly === 1) {
      alerts.push({ key: "anomaly", icon: <Activity className="h-4 w-4" />,
        message: t("alerts.anomaly"), variant: "warning", dismissable: true })
    }
    if (storm === 1) {
      alerts.push({ key: "storm", icon: <ShieldAlert className="h-4 w-4" />,
        message: t("alerts.storm"), variant: "warning", dismissable: true })
    }
    if (curtail === 1) {
      alerts.push({ key: "curtail", icon: <AlertTriangle className="h-4 w-4" />,
        message: t("alerts.curtail"), variant: "info", dismissable: true })
    }
    if (cloud > 90 && pvW < 100) {
      alerts.push({ key: "snow-or-overcast", icon: <CloudSnow className="h-4 w-4" />,
        message: t("alerts.overcast"), variant: "info", dismissable: true })
    }
    if (windowAway === 1) {
      alerts.push({ key: "window-away", icon: <Home className="h-4 w-4" />,
        message: t("alerts.windowAway"), variant: "warning", dismissable: true })
    }
    if (laundryDone === 1) {
      alerts.push({ key: "laundry-done", icon: <Bell className="h-4 w-4" />,
        message: t("alerts.laundryDone"), variant: "info", dismissable: true })
    }
    if (presenceMode === 1) {
      alerts.push({ key: "away-mode", icon: <Home className="h-4 w-4" />,
        message: t("alerts.awayMode"), variant: "info", dismissable: true })
    }

    return alerts
  }, [t, gridStatus, soc, price, anomaly, storm, curtail, pvW, cloud, windowAway, laundryDone, presenceMode])
}

// ── styling ───────────────────────────────────────────────────────────────────

const variantClass: Record<Alert["variant"], string> = {
  destructive: "border-destructive/60 bg-destructive/10 text-destructive",
  warning:     "border-yellow-500/60 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  info:        "border-blue-500/60 bg-blue-500/10 text-blue-700 dark:text-blue-400",
}

const btnClass: Record<Alert["variant"], string> = {
  destructive: "text-destructive/70 hover:text-destructive border-destructive/30 hover:bg-destructive/10",
  warning:     "text-yellow-600/70 hover:text-yellow-700 border-yellow-500/30 hover:bg-yellow-500/10",
  info:        "text-blue-600/70 hover:text-blue-700 border-blue-500/30 hover:bg-blue-500/10",
}

// ── component ─────────────────────────────────────────────────────────────────

export function Alerts() {
  const { t } = useTranslation()
  const alerts = useAlerts()
  const { dismiss, snooze, isHidden } = useAlertActions()

  const visible = alerts.filter(a => !isHidden(a.key))

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
        {t("alerts.allClear")}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {visible.map((a) => (
        <div
          key={a.key}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${variantClass[a.variant]}`}
        >
          <span className="mt-0.5 shrink-0">{a.icon}</span>
          <span className="flex-1">{a.message}</span>
          {a.dismissable && (
            <div className="flex shrink-0 gap-1">
              <Button
                variant="outline"
                size="sm"
                className={`h-6 px-2 text-[10px] ${btnClass[a.variant]}`}
                onClick={() => snooze(a.key)}
              >
                {t("alerts.snooze")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={`h-6 px-2 text-[10px] ${btnClass[a.variant]}`}
                onClick={() => dismiss(a.key)}
              >
                {t("alerts.dismiss")}
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
