import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Download, Sun, Wallet, Zap } from "lucide-react"
import { fetchHistoryMulti } from "@/api/haClient"

// ─── types ───────────────────────────────────────────────────────────────────

interface DayReport {
  date: string              // YYYY-MM-DD
  label: string             // localised short label
  pvKwh: number
  netKwh: number            // + export, − import
  costPln: number           // + revenue, − spending
  selfPct: number           // self-consumption %
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const ENTITIES = [
  "sensor.ems_energia_pv_riemann",
  "sensor.ems_energia_netto_riemann",
  "sensor.ems_bilans_finansowy_dzis",
]

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function weekStart(ref: Date): Date {
  const d = new Date(ref)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday
  d.setHours(0, 0, 0, 0)
  return d
}

/** Last numeric state per calendar date (YYYY-MM-DD) */
function lastPerDay(series: Array<{ state: string; last_changed: string }>): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of series) {
    const v = parseFloat(r.state)
    if (!isNaN(v)) m.set(r.last_changed.slice(0, 10), v)
  }
  return m
}

function downloadCSV(rows: DayReport[], t: (k: string) => string) {
  const header = [
    t("reports.date"),
    `${t("reports.pv")} (kWh)`,
    `${t("reports.net")} (kWh)`,
    `${t("reports.balance")} (PLN)`,
    `${t("reports.selfConsumption")} (%)`,
  ].join(",")
  const body = rows
    .map((r) =>
      [r.date, r.pvKwh.toFixed(3), r.netKwh.toFixed(3), r.costPln.toFixed(2), r.selfPct.toFixed(1)].join(",")
    )
    .join("\n")
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `ems-report-${rows[0]?.date ?? "week"}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── hook ────────────────────────────────────────────────────────────────────

function useWeekReport(weekOffset: number) {
  const [rows, setRows] = useState<DayReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!cancelled) { setLoading(true); setRows([]) }
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const mon = weekStart(addDays(today, weekOffset * 7))
      const sun = addDays(mon, 6)
      // Fetch from Monday 00:00 to end of Sunday (or now if current week)
      const endDate = weekOffset === 0 ? new Date() : addDays(sun, 1)
      const startIso = mon.toISOString()
      const endIso = endDate.toISOString()

      const data = await fetchHistoryMulti(ENTITIES, startIso, endIso)
      if (cancelled) return

      const pvMap  = lastPerDay(data.get("sensor.ems_energia_pv_riemann")  ?? [])
      const netMap = lastPerDay(data.get("sensor.ems_energia_netto_riemann") ?? [])
      const costMap = lastPerDay(data.get("sensor.ems_bilans_finansowy_dzis") ?? [])

      const result: DayReport[] = []
      for (let i = 0; i < 7; i++) {
        const d = addDays(mon, i)
        if (d > new Date()) break
        const date = isoDate(d)
        const pvKwh   = pvMap.get(date)  ?? 0
        const netKwh  = netMap.get(date) ?? 0
        const costPln = costMap.get(date) ?? 0
        const exported = Math.max(0, netKwh)
        const selfPct = pvKwh > 0 ? Math.min(100, ((pvKwh - exported) / pvKwh) * 100) : 0
        result.push({
          date,
          label: d.toLocaleDateString("pl-PL", { weekday: "short", day: "numeric" }),
          pvKwh,
          netKwh,
          costPln,
          selfPct: Math.round(selfPct * 10) / 10,
        })
      }
      if (!cancelled) {
        setRows(result)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [weekOffset])

  return { rows, loading }
}

// ─── summary cards ───────────────────────────────────────────────────────────

function SumCard({ icon, label, value, unit, color }: {
  icon: React.ReactNode; label: string; value: string; unit: string; color?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="flex items-end gap-1">
        <span className="text-xl font-bold tabular-nums" style={{ color }}>{value}</span>
        <span className="mb-0.5 text-xs text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}

// ─── main ────────────────────────────────────────────────────────────────────

export function Reports() {
  const { t } = useTranslation()
  const [weekOffset, setWeekOffset] = useState(0)
  const { rows, loading } = useWeekReport(weekOffset)

  const totalPv   = rows.reduce((s, r) => s + r.pvKwh, 0)
  const totalCost = rows.reduce((s, r) => s + r.costPln, 0)
  const avgSelf   = rows.length ? rows.reduce((s, r) => s + r.selfPct, 0) / rows.length : 0

  const weekLabel = (() => {
    const today = new Date(); today.setHours(0,0,0,0)
    const mon = weekStart(addDays(today, weekOffset * 7))
    const sun = addDays(mon, 6)
    return `${mon.toLocaleDateString("pl-PL", { day: "numeric", month: "short" })} – ${sun.toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}`
  })()

  return (
    <div className="space-y-4">

      {/* Week navigator */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => setWeekOffset((o) => o - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold">{weekOffset === 0 ? t("reports.thisWeek") : weekLabel}</p>
          {weekOffset !== 0 && <p className="text-xs text-muted-foreground">{weekLabel}</p>}
        </div>
        <Button variant="ghost" size="icon" disabled={weekOffset >= 0} onClick={() => setWeekOffset((o) => o + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <SumCard
          icon={<Sun className="h-3.5 w-3.5 text-yellow-400" />}
          label={t("reports.totalPv")} value={totalPv.toFixed(1)} unit="kWh"
          color="#4ade80"
        />
        <SumCard
          icon={<Wallet className="h-3.5 w-3.5" />}
          label={t("reports.totalBalance")}
          value={(totalCost >= 0 ? "+" : "") + totalCost.toFixed(2)} unit="PLN"
          color={totalCost >= 0 ? "#4ade80" : "#f87171"}
        />
        <SumCard
          icon={<Zap className="h-3.5 w-3.5 text-blue-400" />}
          label={t("reports.avgSelf")} value={avgSelf.toFixed(0)} unit="%"
        />
      </div>

      {/* Bar chart */}
      <Card>
        <CardHeader className="pb-1 pt-3 px-4">
          <p className="text-sm font-semibold">{t("reports.chartTitle")}</p>
        </CardHeader>
        <CardContent className="px-2 pb-4">
          {loading ? (
            <div className="h-40 animate-pulse rounded-md bg-muted/40" />
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} unit=" kWh" width={52} />
                <Tooltip
                  contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [`${v.toFixed(2)} kWh`, t("reports.pv")]}
                />
                <ReferenceLine y={0} stroke="var(--border)" />
                <Bar dataKey="pvKwh" fill="#4ade80" radius={[3, 3, 0, 0]} name={t("reports.pv")} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t("reports.date")}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">PV (kWh)</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("reports.net")} (kWh)</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("reports.balance")} (PLN)</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("reports.selfConsumption")}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    <div className="mx-auto h-4 w-32 animate-pulse rounded bg-muted/40" />
                  </td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">{t("reports.noData")}</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.date} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-500">{r.pvKwh.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: r.netKwh >= 0 ? "#4ade80" : "#f87171" }}>
                      {r.netKwh >= 0 ? "+" : ""}{r.netKwh.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: r.costPln >= 0 ? "#4ade80" : "#f87171" }}>
                      {r.costPln >= 0 ? "+" : ""}{r.costPln.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.selfPct.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot className="border-t bg-muted/30">
                  <tr>
                    <td className="px-3 py-2 text-xs font-semibold text-muted-foreground">{t("reports.total")}</td>
                    <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums text-green-500">{totalPv.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums" style={{ color: rows.reduce((s,r)=>s+r.netKwh,0) >= 0 ? "#4ade80" : "#f87171" }}>
                      {(rows.reduce((s,r)=>s+r.netKwh,0) >= 0 ? "+" : "")}{rows.reduce((s,r)=>s+r.netKwh,0).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums" style={{ color: totalCost >= 0 ? "#4ade80" : "#f87171" }}>
                      {totalCost >= 0 ? "+" : ""}{totalCost.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{avgSelf.toFixed(0)}%</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* CSV export */}
      {!loading && rows.length > 0 && (
        <Button variant="outline" className="w-full gap-2" onClick={() => downloadCSV(rows, t)}>
          <Download className="h-4 w-4" />
          {t("reports.exportCsv")}
        </Button>
      )}

    </div>
  )
}
