import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Zap, BatteryLow, CloudSnow, Activity, ShieldAlert } from "lucide-react"
import { useEntityNum, useEntityState } from "@/hooks/useHA"

interface Alert {
  key: string
  icon: React.ReactNode
  message: string
  variant: "destructive" | "warning" | "info"
}

function useAlerts(): Alert[] {
  const { t } = useTranslation()

  const gridStatus   = useEntityNum("sensor.ems_status_sieci", 0)
  const soc          = useEntityNum("sensor.sztuczny_stan_baterii_soc", 50)
  const price        = useEntityNum("sensor.ems_biezaca_cena_energii", 30)
  const anomaly      = useEntityNum("sensor.ems_symuluj_awarie_api", 0)
  const storm        = useEntityNum("sensor.ems_storm_safeguard", 0)
  const curtail      = useEntityNum("sensor.ems_ograniczenie_pv", 0)
  const pvW          = useEntityNum("sensor.sztuczna_produkcja_pv", 0)
  // snow: PV clipped to very low during daytime (rough heuristic via cloud cover proxy)
  const cloudStr     = useEntityState("sensor.cloud_cover", "0")
  const cloud        = Number(cloudStr)

  return useMemo(() => {
    const alerts: Alert[] = []

    if (gridStatus === 1) {
      alerts.push({
        key: "blackout",
        icon: <Zap className="h-4 w-4" />,
        message: t("alerts.blackout"),
        variant: "destructive",
      })
    }
    if (soc <= 10) {
      alerts.push({
        key: "soc-critical",
        icon: <BatteryLow className="h-4 w-4" />,
        message: t("alerts.socCritical", { soc: Math.round(soc) }),
        variant: "destructive",
      })
    } else if (soc <= 20) {
      alerts.push({
        key: "soc-low",
        icon: <BatteryLow className="h-4 w-4" />,
        message: t("alerts.socLow", { soc: Math.round(soc) }),
        variant: "warning",
      })
    }
    if (price < 0) {
      alerts.push({
        key: "negative-price",
        icon: <AlertTriangle className="h-4 w-4" />,
        message: t("alerts.negativePrice", { price: price.toFixed(1) }),
        variant: "info",
      })
    }
    if (anomaly === 1) {
      alerts.push({
        key: "anomaly",
        icon: <Activity className="h-4 w-4" />,
        message: t("alerts.anomaly"),
        variant: "warning",
      })
    }
    if (storm === 1) {
      alerts.push({
        key: "storm",
        icon: <ShieldAlert className="h-4 w-4" />,
        message: t("alerts.storm"),
        variant: "warning",
      })
    }
    if (curtail === 1) {
      alerts.push({
        key: "curtail",
        icon: <AlertTriangle className="h-4 w-4" />,
        message: t("alerts.curtail"),
        variant: "info",
      })
    }
    if (cloud > 90 && pvW < 100) {
      alerts.push({
        key: "snow-or-overcast",
        icon: <CloudSnow className="h-4 w-4" />,
        message: t("alerts.overcast"),
        variant: "info",
      })
    }

    return alerts
  }, [t, gridStatus, soc, price, anomaly, storm, curtail, pvW, cloud])
}

const variantClass: Record<Alert["variant"], string> = {
  destructive: "border-destructive/60 bg-destructive/10 text-destructive",
  warning:     "border-yellow-500/60 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  info:        "border-blue-500/60 bg-blue-500/10 text-blue-700 dark:text-blue-400",
}

export function Alerts() {
  const { t } = useTranslation()
  const alerts = useAlerts()

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
        {t("alerts.allClear")}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.key}
          className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${variantClass[a.variant]}`}
        >
          {a.icon}
          {a.message}
        </div>
      ))}
    </div>
  )
}
