import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { useEntityNum } from "@/hooks/useHA"
import { useWeekReport, isoDate, type DayReport } from "@/hooks/useWeekReport"
import { TrendingUp, CalendarRange, Sun } from "lucide-react"

// ─── projection (pure, tested) ───────────────────────────────────────────────

export interface CostProjection {
  weekProjected: number   // completed-day actuals + avg × (remaining incl. today)
  avgDaily: number        // mean balance over completed days
  completedDays: number
}

// Project the full-week financial balance from the days we have so far.
// "Completed" days (before today) count as actuals; today and any future days
// are estimated at the average of the completed days. costPln/balance sign is
// preserved (+ revenue, − spending).
export function projectWeekCost(rows: DayReport[], todayISO: string): CostProjection {
  const completed = rows.filter((r) => r.date < todayISO)
  const completedSum = completed.reduce((s, r) => s + r.costPln, 0)
  const avgDaily = completed.length
    ? completedSum / completed.length
    : rows.length
      ? rows[rows.length - 1].costPln
      : 0
  const remaining = 7 - completed.length          // today + not-yet-started days
  const weekProjected = completedSum + avgDaily * remaining
  return { weekProjected, avgDaily, completedDays: completed.length }
}

// ─── presentation ────────────────────────────────────────────────────────────

const COST_COLOR = (v: number) => (v >= 0 ? "#4ade80" : "#f87171")

function Row({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <div className="text-sm font-semibold tabular-nums" style={{ color }}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </div>
    </div>
  )
}

export function CostForecast() {
  const { t } = useTranslation()
  const { rows, loading } = useWeekReport(0)

  const pvTomorrow = useEntityNum("sensor.ems_prognoza_pv_jutro_kwh", 0) / 10  // raw is kWh×10
  const priceGr    = useEntityNum("sensor.ems_biezaca_cena_energii", 0)        // gr/kWh
  const pvValueZl  = (pvTomorrow * priceGr) / 100

  const { weekProjected, avgDaily, completedDays } = projectWeekCost(rows, isoDate(new Date()))
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} zł`

  return (
    <Card className="border-primary/20">
      <CardContent className="space-y-2 p-3 sm:p-4">
        <div className="mb-1 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t("forecast.title")}</h2>
        </div>

        <Row
          icon={CalendarRange}
          label={t("forecast.weekProjected")}
          value={loading ? "…" : fmt(weekProjected)}
          color={loading ? undefined : COST_COLOR(weekProjected)}
        />
        <Row
          icon={TrendingUp}
          label={t("forecast.avgDaily")}
          value={loading ? "…" : fmt(avgDaily)}
          color={loading ? undefined : COST_COLOR(avgDaily)}
        />
        <Row
          icon={Sun}
          label={t("forecast.pvTomorrow")}
          value={`${pvTomorrow.toFixed(1)} kWh`}
          sub={`~${pvValueZl.toFixed(2)} zł`}
          color="#66bb6a"
        />

        <p className="pt-1 text-[10px] text-muted-foreground">
          {loading
            ? t("forecast.note")
            : t("forecast.noteDays", { count: completedDays })}
        </p>
      </CardContent>
    </Card>
  )
}
