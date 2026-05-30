import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts"
import {
  Sun, CloudSun, CloudRain, CloudSnow, CloudLightning, CloudFog,
  Thermometer, Zap, TrendingUp, ChevronLeft, ChevronRight,
} from "lucide-react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useEntityNum } from "@/hooks/useHA"
import { useWeather, type WeatherHour } from "@/hooks/useWeather"
import { cn } from "@/lib/utils"

// ─── WMO weather code helpers ────────────────────────────────────────────────

function wmoIcon(code: number, size = "h-4 w-4") {
  const cls = size
  if (code === 0)                         return <Sun           className={cn(cls, "text-yellow-400")} />
  if (code <= 3)                          return <CloudSun      className={cn(cls, "text-yellow-300")} />
  if (code <= 48)                         return <CloudFog      className={cn(cls, "text-slate-400")} />
  if (code <= 67)                         return <CloudRain     className={cn(cls, "text-blue-400")} />
  if (code <= 77)                         return <CloudSnow     className={cn(cls, "text-blue-200")} />
  if (code <= 82)                         return <CloudRain     className={cn(cls, "text-blue-500")} />
  return                                         <CloudLightning className={cn(cls, "text-yellow-500")} />
}

function wmoLabel(code: number, t: (k: string) => string): string {
  if (code === 0)   return t("weather.wmo.clear")
  if (code <= 3)    return t("weather.wmo.partlyCloudy")
  if (code <= 48)   return t("weather.wmo.foggy")
  if (code <= 67)   return t("weather.wmo.rainy")
  if (code <= 77)   return t("weather.wmo.snowy")
  if (code <= 82)   return t("weather.wmo.showers")
  return                  t("weather.wmo.thunderstorm")
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtHour(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, "0")}:00`
}

function fmtDayShort(ts: number, locale: string) {
  return new Date(ts).toLocaleDateString(locale, { weekday: "short", day: "numeric" })
}

function fmtDayFull(ts: number, locale: string) {
  return new Date(ts).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })
}

// ─── stat box ────────────────────────────────────────────────────────────────

function StatBox({
  icon, label, value, unit, sub,
}: {
  icon: React.ReactNode; label: string; value: string | number; unit?: string; sub?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        {unit && <span className="mb-0.5 text-sm text-muted-foreground">{unit}</span>}
      </div>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </div>
  )
}

// ─── day summaries ────────────────────────────────────────────────────────────

interface DaySummary {
  ts: number          // midnight timestamp of the day
  peakGhi: number
  peakHour: number
  solarHours: number
  avgCloud: number
  avgTemp: number
  dominantCode: number  // weatherCode of the peak-GHI hour
}

function useDaySummaries(hours: WeatherHour[]): DaySummary[] {
  return useMemo(() => {
    if (!hours.length) return []
    const byDay = new Map<string, WeatherHour[]>()
    for (const h of hours) {
      const key = new Date(h.ts).toDateString()
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key)!.push(h)
    }
    return Array.from(byDay.values()).map((dayHours) => {
      const peak = dayHours.reduce((a, b) => (a.ghi > b.ghi ? a : b))
      return {
        ts: dayHours[0].ts,
        peakGhi: Math.round(peak.ghi),
        peakHour: new Date(peak.ts).getHours(),
        solarHours: dayHours.filter((h) => h.ghi > 50).length,
        avgCloud: Math.round(dayHours.reduce((s, h) => s + h.cloud, 0) / dayHours.length),
        avgTemp: Math.round((dayHours.reduce((s, h) => s + h.temp, 0) / dayHours.length) * 10) / 10,
        dominantCode: peak.weatherCode,
      }
    })
  }, [hours])
}

// ─── main component ──────────────────────────────────────────────────────────

export function Weather() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === "pl" ? "pl-PL" : "en-GB"

  const { hours, currentHour, loading, error } = useWeather()
  const daySummaries = useDaySummaries(hours)

  const [selectedDay, setSelectedDay] = useState(0)

  // Keep selection in bounds if data arrives late
  const safeDay = Math.min(selectedDay, Math.max(0, daySummaries.length - 1))

  // Snapshot "now" for the reference line asynchronously (ESLint purity rules)
  const [nowTs, setNowTs] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setNowTs(Date.now()), 0)
    return () => clearTimeout(id)
  }, [hours])

  // Live PV from HA entity (updated every 5s by simulator via Modbus)
  const pvNow      = useEntityNum("sensor.sztuczna_produkcja_pv", 0)
  const pvTomorrow = useEntityNum("sensor.ems_pv_forecast_tomorrow_kwh", 0)

  // Current conditions from Open-Meteo current hour (reliable — temp/cloud/GHI
  // are written to InfluxDB only, not as HA entities)
  const temp  = currentHour?.temp  ?? 0
  const cloud = currentHour?.cloud ?? 0
  const ghi   = currentHour?.ghi   ?? 0

  // Chart data: 24 hours of the selected day (Open-Meteo returns midnight-to-midnight slices)
  const chartData: WeatherHour[] = hours.slice(safeDay * 24, (safeDay + 1) * 24)

  // Hourly strip: every 2 hours to avoid clutter (12 icons per day)
  const stripHours = chartData.filter((_, i) => i % 2 === 0)

  if (loading) return <div className="h-64 animate-pulse rounded-lg bg-muted/40" />

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
          value={temp.toFixed(1)}
          unit="°C"
          sub={t("weather.outdoor")}
        />
        <StatBox
          icon={wmoIcon(currentHour?.weatherCode ?? 0, "h-3.5 w-3.5")}
          label={t("weather.cloud")}
          value={Math.round(cloud)}
          unit="%"
          sub={currentHour ? wmoLabel(currentHour.weatherCode, t) : "—"}
        />
        <StatBox
          icon={<Sun className="h-3.5 w-3.5 text-yellow-400" />}
          label={t("weather.ghi")}
          value={Math.round(ghi)}
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

      {/* Day selector */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost" size="icon" className="h-7 w-7 shrink-0"
          disabled={safeDay === 0}
          onClick={() => setSelectedDay((d) => Math.max(0, d - 1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex flex-1 gap-1.5 overflow-x-auto pb-1">
          {daySummaries.map((day, i) => (
            <button
              key={day.ts}
              onClick={() => setSelectedDay(i)}
              className={cn(
                "flex shrink-0 flex-col items-center gap-0.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors",
                safeDay === i
                  ? "border-primary bg-primary/10 font-semibold text-primary"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              <span className="font-medium">{fmtDayShort(day.ts, locale)}</span>
              {wmoIcon(day.dominantCode, "h-4 w-4")}
              <span>{day.avgTemp.toFixed(0)}°</span>
            </button>
          ))}
        </div>

        <Button
          variant="ghost" size="icon" className="h-7 w-7 shrink-0"
          disabled={safeDay === daySummaries.length - 1}
          onClick={() => setSelectedDay((d) => Math.min(daySummaries.length - 1, d + 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-1 pt-3 px-4">
          <p className="text-sm font-semibold">
            {chartData[0] ? fmtDayFull(chartData[0].ts, locale) : "—"} — {t("weather.chartTitle")}
          </p>
        </CardHeader>
        <CardContent className="px-2 pb-2">
          <ResponsiveContainer width="100%" height={200}>
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
                axisLine={false} tickLine={false}
                unit=" W/m²" width={64}
              />
              <YAxis
                yAxisId="temp"
                orientation="right"
                domain={["auto", "auto"]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false} tickLine={false}
                unit="°C" width={40}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
                labelFormatter={(v: number) => `${fmtHour(v)}`}
                formatter={(value: number, name: string) => {
                  if (name === "ghi")   return [`${Math.round(value)} W/m²`, "GHI"]
                  if (name === "temp")  return [`${value.toFixed(1)} °C`, t("weather.temp")]
                  if (name === "cloud") return [`${Math.round(value)} %`, t("weather.cloud")]
                  return [value, name]
                }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const h = chartData.find((x) => x.ts === label)
                  return (
                    <div className="rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow">
                      <p className="mb-1 font-semibold">{fmtHour(label as number)}</p>
                      {h && (
                        <div className="flex items-center gap-1 mb-1">
                          {wmoIcon(h.weatherCode, "h-3.5 w-3.5")}
                          <span>{wmoLabel(h.weatherCode, t)}</span>
                        </div>
                      )}
                      {payload.map((p) => (
                        <div key={p.name} className="flex justify-between gap-4">
                          <span className="text-muted-foreground">
                            {p.name === "ghi" ? "GHI" : p.name === "temp" ? t("weather.temp") : t("weather.cloud")}
                          </span>
                          <span className="font-medium">
                            {p.name === "ghi"
                              ? `${Math.round(p.value as number)} W/m²`
                              : p.name === "temp"
                              ? `${(p.value as number).toFixed(1)} °C`
                              : `${Math.round(p.value as number)} %`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                }}
              />
              {safeDay === 0 && nowTs > 0 && (
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

          {/* Hourly weather icon strip */}
          <div className="mt-1 flex justify-around border-t pt-2">
            {stripHours.map((h) => (
              <div key={h.ts} className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-muted-foreground">{fmtHour(h.ts)}</span>
                {wmoIcon(h.weatherCode, "h-4 w-4")}
                <span className="text-[10px] font-medium">{h.temp.toFixed(0)}°</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Selected day summary */}
      {daySummaries[safeDay] && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <div className="text-muted-foreground">{t("weather.peakGhi")}</div>
              <div className="text-right font-medium text-yellow-500">
                {daySummaries[safeDay].peakGhi} W/m²
                <span className="ml-1 text-xs text-muted-foreground">
                  ({String(daySummaries[safeDay].peakHour).padStart(2, "0")}:00)
                </span>
              </div>

              <div className="text-muted-foreground">{t("weather.solarHours")}</div>
              <div className="text-right font-medium">{daySummaries[safeDay].solarHours}h</div>

              <div className="text-muted-foreground">{t("weather.avgCloud")}</div>
              <div className="text-right font-medium">{daySummaries[safeDay].avgCloud}%</div>

              <div className="text-muted-foreground">{t("weather.avgTemp")}</div>
              <div className="text-right font-medium">{daySummaries[safeDay].avgTemp.toFixed(1)} °C</div>

              {safeDay === 1 && (
                <>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {t("weather.pvForecast")}
                  </div>
                  <div className="text-right font-semibold text-green-500">
                    {pvTomorrow.toFixed(1)} kWh
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
