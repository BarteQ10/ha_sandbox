import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts"
import { Sun, Cloud, CloudSun, Thermometer, Zap, TrendingUp } from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useEntityNum } from "@/hooks/useHA"
import { useWeather, type WeatherHour } from "@/hooks/useWeather"

// ─── helpers ────────────────────────────────────────────────────────────────

function cloudIcon(cloud: number) {
  if (cloud < 25) return <Sun className="h-5 w-5 text-yellow-400" />
  if (cloud < 65) return <CloudSun className="h-5 w-5 text-yellow-300" />
  return <Cloud className="h-5 w-5 text-slate-400" />
}

function fmtHour(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, "0")}:00`
}

function fmtDay(ts: number) {
  return new Date(ts).toLocaleDateString("pl-PL", { weekday: "short", day: "numeric", month: "short" })
}

function ghiColor(ghi: number) {
  if (ghi < 100) return "var(--muted-foreground)"
  if (ghi < 400) return "#fb923c"
  return "#fbbf24"
}

// ─── sub-components ─────────────────────────────────────────────────────────

function StatBox({
  icon, label, value, unit, sub,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  unit?: string
  sub?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        {unit && <span className="mb-0.5 text-sm text-muted-foreground">{unit}</span>}
      </div>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

interface DaySummary {
  label: string
  peakGhi: number
  peakHour: number
  solarHours: number
  avgCloud: number
  pvForecastKwh: number | null
}

function useDaySummaries(hours: WeatherHour[], pvTomorrow: number): DaySummary[] {
  return useMemo(() => {
    if (!hours.length) return []
    const byDay = new Map<string, WeatherHour[]>()
    for (const h of hours) {
      const key = new Date(h.ts).toDateString()
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key)!.push(h)
    }
    const result: DaySummary[] = []
    let dayIndex = 0
    for (const [, dayHours] of byDay) {
      const peakEntry = dayHours.reduce((a, b) => (a.ghi > b.ghi ? a : b))
      const avgCloud = Math.round(dayHours.reduce((s, h) => s + h.cloud, 0) / dayHours.length)
      result.push({
        label: fmtDay(dayHours[0].ts),
        peakGhi: Math.round(peakEntry.ghi),
        peakHour: new Date(peakEntry.ts).getHours(),
        solarHours: dayHours.filter((h) => h.ghi > 50).length,
        avgCloud,
        pvForecastKwh: dayIndex === 1 ? pvTomorrow : null,
      })
      dayIndex++
    }
    return result
  }, [hours, pvTomorrow])
}

// ─── main component ──────────────────────────────────────────────────────────

export function Weather() {
  const { t } = useTranslation()
  const { hours, loading, error } = useWeather()

  // Snapshot current time asynchronously after forecast loads so ESLint
  // purity rules are satisfied (Date.now() must not be called during render,
  // setState must not be called synchronously inside an effect body).
  const [nowTs, setNowTs] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setNowTs(Date.now()), 0)
    return () => clearTimeout(id)
  }, [hours])

  const pvNow      = useEntityNum("sensor.sztuczna_produkcja_pv", 0)
  const tempNow    = useEntityNum("sensor.current_temp", 0)
  const cloudNow   = useEntityNum("sensor.cloud_cover", 0)
  const ghiNow     = useEntityNum("sensor.shortwave_radiation", 0)
  const pvTomorrow = useEntityNum("sensor.ems_pv_forecast_tomorrow_kwh", 0)

  const daySummaries = useDaySummaries(hours, pvTomorrow)

  const chartData = useMemo(
    () => hours.filter((h) => h.ts >= nowTs - 30 * 60_000 && h.ts <= nowTs + 24 * 3600_000),
    [hours, nowTs]
  )

  if (loading) {
    return <div className="h-64 animate-pulse rounded-lg bg-muted/40" />
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center text-sm text-destructive">
        {t("weather.fetchError")}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Current conditions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox
          icon={<Thermometer className="h-3.5 w-3.5" />}
          label={t("weather.temp")}
          value={tempNow.toFixed(1)}
          unit="°C"
          sub={t("weather.outdoor")}
        />
        <StatBox
          icon={cloudIcon(cloudNow)}
          label={t("weather.cloud")}
          value={Math.round(cloudNow)}
          unit="%"
          sub={
            cloudNow < 25
              ? t("weather.clear")
              : cloudNow < 65
              ? t("weather.partlyCloudy")
              : t("weather.overcast")
          }
        />
        <StatBox
          icon={<Sun className="h-3.5 w-3.5 text-yellow-400" />}
          label={t("weather.ghi")}
          value={Math.round(ghiNow)}
          unit="W/m²"
          sub={t("weather.ghiSub")}
        />
        <StatBox
          icon={<Zap className="h-3.5 w-3.5 text-green-400" />}
          label={t("weather.pvNow")}
          value={Math.round(pvNow)}
          unit="W"
          sub={`${((pvNow / 5000) * 100).toFixed(0)}% ${t("weather.ofPeak")}`}
        />
      </div>

      {/* 24h forecast chart */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <p className="text-sm font-semibold">{t("weather.chart24h")}</p>
        </CardHeader>
        <CardContent className="px-2 pb-4">
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="ts"
                scale="time"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={fmtHour}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                yAxisId="ghi"
                orientation="left"
                domain={[0, "auto"]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                unit=" W/m²"
                width={64}
              />
              <YAxis
                yAxisId="temp"
                orientation="right"
                domain={["auto", "auto"]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                unit="°C"
                width={40}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
                labelFormatter={(v: number) => `${fmtDay(v)}  ${fmtHour(v)}`}
                formatter={(value: number, name: string) => {
                  if (name === "ghi")   return [`${Math.round(value)} W/m²`, "GHI"]
                  if (name === "temp")  return [`${value.toFixed(1)} °C`, t("weather.temp")]
                  return [value, name]
                }}
              />
              {nowTs > 0 && (
                <ReferenceLine
                  yAxisId="ghi"
                  x={nowTs}
                  stroke="var(--primary)"
                  strokeDasharray="4 2"
                  label={{ value: t("weather.now"), fill: "var(--primary)", fontSize: 11, position: "top" }}
                />
              )}
              <Area
                yAxisId="ghi"
                type="monotone"
                dataKey="ghi"
                stroke="#fbbf24"
                fill="#fbbf2430"
                strokeWidth={2}
                dot={false}
                name="ghi"
              />
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="temp"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
                name="temp"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Day summaries */}
      <div className="grid gap-3 sm:grid-cols-2">
        {daySummaries.map((day) => (
          <Card key={day.label}>
            <CardContent className="p-4">
              <p className="mb-2 text-sm font-semibold">{day.label}</p>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <div className="text-muted-foreground">{t("weather.peakGhi")}</div>
                <div className="text-right font-medium" style={{ color: ghiColor(day.peakGhi) }}>
                  {day.peakGhi} W/m²
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({String(day.peakHour).padStart(2, "0")}:00)
                  </span>
                </div>

                <div className="text-muted-foreground">{t("weather.solarHours")}</div>
                <div className="text-right font-medium">{day.solarHours}h</div>

                {day.pvForecastKwh !== null && (
                  <>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <TrendingUp className="h-3.5 w-3.5" />
                      {t("weather.pvForecast")}
                    </div>
                    <div className="text-right font-semibold text-green-500">
                      {day.pvForecastKwh.toFixed(1)} kWh
                    </div>
                  </>
                )}

                <div className="text-muted-foreground">{t("weather.avgCloud")}</div>
                <div className="text-right font-medium">{day.avgCloud}%</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
