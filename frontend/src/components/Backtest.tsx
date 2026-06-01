import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid,
} from "recharts"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FlaskConical, Trophy, TrendingDown, Play } from "lucide-react"
import { runBacktest, type BacktestResult } from "@/api/backtest"

const DAY_OPTIONS = [3, 7, 14, 30]
const STRATEGY_COLORS = ["#9ca3af", "#38bdf8", "#4ade80", "#fb923c"]

// ─── cumulative-cost chart ──────────────────────────────────────────────────────

function CumulativeChart({ result }: { result: BacktestResult }) {
  // Merge each strategy's cumulative_cost onto the shared timeline, downsampled
  const n = result.timeline.length
  const step = Math.max(1, Math.floor(n / 120))
  const data: Record<string, number | string>[] = []
  for (let i = 0; i < n; i += step) {
    const point: Record<string, number | string> = { ts: result.timeline[i] }
    result.strategies.forEach((s, si) => {
      point[`s${si}`] = s.cumulative_cost[i] ?? 0
    })
    data.push(point)
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="ts"
          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
          tickFormatter={(v: string) => {
            const d = new Date(v)
            return `${d.getDate()}/${d.getMonth() + 1}`
          }}
          axisLine={{ stroke: "var(--border)" }} tickLine={false} minTickGap={40}
        />
        <YAxis
          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
          axisLine={false} tickLine={false} width={44} unit=" zł"
        />
        <Tooltip
          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(v) => new Date(String(v)).toLocaleString()}
          formatter={(val, name) => [`${Number(val).toFixed(2)} zł`, name as string]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {result.strategies.map((s, si) => (
          <Line
            key={si} type="monotone" dataKey={`s${si}`} name={s.name.split(" ")[0]}
            stroke={STRATEGY_COLORS[si]} strokeWidth={2} dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── main component ─────────────────────────────────────────────────────────────

export function Backtest() {
  const { t } = useTranslation()
  const [days, setDays] = useState(7)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setLoading(true)
    setError(null)
    try {
      const r = await runBacktest(days)
      setResult(r)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg === "no_data" ? t("backtest.noData") : t("backtest.error", { msg }))
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <h2 className="text-base font-semibold sm:text-lg">{t("backtest.title")}</h2>

      {/* Controls */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{t("backtest.period")}</span>
          </div>
          <div className="flex gap-1">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-md px-2.5 py-1 text-sm transition-colors ${
                  days === d
                    ? "bg-primary text-primary-foreground"
                    : "border hover:bg-accent"
                }`}
              >
                {d}{t("backtest.daysUnit")}
              </button>
            ))}
          </div>
          <Button onClick={run} disabled={loading} className="ml-auto gap-2">
            <Play className="h-4 w-4" />
            {loading ? t("backtest.running") : t("backtest.run")}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-yellow-500/60 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="h-64 animate-pulse rounded-lg bg-muted/40" />
      )}

      {result && !loading && (
        <>
          {/* Headline */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <Card className="border-green-500/30 bg-green-500/5">
              <CardContent className="flex items-center gap-3 p-4">
                <Trophy className="h-6 w-6 shrink-0 text-green-500" />
                <div>
                  <p className="text-xs text-muted-foreground">{t("backtest.bestStrategy")}</p>
                  <p className="text-sm font-bold capitalize">{result.best.split(" ")[0]}</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-green-500/30 bg-green-500/5">
              <CardContent className="flex items-center gap-3 p-4">
                <TrendingDown className="h-6 w-6 shrink-0 text-green-500" />
                <div>
                  <p className="text-xs text-muted-foreground">{t("backtest.savingsVsBaseline")}</p>
                  <p className="text-sm font-bold">
                    {result.savings_pln.toFixed(2)} zł
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      (~{result.savings_year_est.toFixed(0)} zł/{t("backtest.year")})
                    </span>
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            {t("backtest.dataRange", {
              rows: result.rows,
              from: new Date(result.from).toLocaleDateString(),
              to: new Date(result.to).toLocaleDateString(),
            })}
          </p>

          {/* Strategy table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t("backtest.strategy")}</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("backtest.cost")}</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("backtest.savings")}</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("backtest.import")}</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("backtest.selfSuff")}</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("backtest.cycles")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.strategies.map((s, si) => {
                      const isBest = s.name === result.best
                      return (
                        <tr key={s.name} className={`border-t ${isBest ? "bg-green-500/5" : ""}`}>
                          <td className="px-3 py-2 font-medium">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ background: STRATEGY_COLORS[si] }} />
                              <span className="capitalize">{s.name.split(" ")[0]}</span>
                              {isBest && <Trophy className="h-3 w-3 text-green-500" />}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{s.cost_pln.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right tabular-nums" style={{
                            color: s.savings_pct > 0 ? "#4ade80" : s.savings_pct < 0 ? "#f87171" : undefined,
                          }}>
                            {s.savings_pct > 0 ? "+" : ""}{s.savings_pct.toFixed(1)}%
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.import_kwh.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{(s.self_sufficiency * 100).toFixed(0)}%</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.charge_cycles.toFixed(1)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Cumulative cost chart */}
          <Card>
            <CardHeader className="pb-1 pt-3 px-4">
              <p className="text-sm font-semibold">{t("backtest.cumulativeTitle")}</p>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <CumulativeChart result={result} />
            </CardContent>
          </Card>
        </>
      )}

      {!result && !loading && !error && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("backtest.hint")}</p>
      )}
    </div>
  )
}
