import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
import { useEntityNum, useEntityState } from "@/hooks/useHA"
import { fetchHistoryMulti } from "@/api/haClient"
import { Brain, Cpu, Check, GitCompareArrows } from "lucide-react"

// ─── action mapping ────────────────────────────────────────────────────────────

const ACTION_COLORS = ["#9e9e9e", "#4ade80", "#fb923c"] // Auto / Charge / Discharge

function actionLabel(a: number, t: (k: string) => string) {
  if (a === 1) return t("compare.charge")
  if (a === 2) return t("compare.discharge")
  return t("compare.auto")
}

// ─── current decision badge ─────────────────────────────────────────────────────

function DecisionBadge({ icon: Icon, label, action, t }: {
  icon: React.ElementType; label: string; action: number; t: (k: string) => string
}) {
  const color = ACTION_COLORS[action] ?? ACTION_COLORS[0]
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border bg-card/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <span className="rounded-full px-2.5 py-0.5 text-sm font-semibold" style={{ color, borderColor: color, border: "1px solid" }}>
        {actionLabel(action, t)}
      </span>
    </div>
  )
}

// ─── decision history chart (step lines, MPC vs RL) ─────────────────────────────

interface Point { ts: number; mpc: number; rl: number }

function DecisionChart({ rlEnabled }: { rlEnabled: boolean }) {
  const { t } = useTranslation()
  const [data, setData] = useState<Point[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      try {
        const end = new Date().toISOString()
        const start = new Date(Date.now() - 12 * 3600_000).toISOString()
        const hist = await fetchHistoryMulti(
          ["sensor.ems_mpc_akcja", "sensor.ems_rl_akcja"], start, end,
        )
        if (ignore) return

        // Merge both series on a forward-filled timeline
        type Row = { state: string; last_changed: string }
        const mpcRows = (hist.get("sensor.ems_mpc_akcja") ?? []) as Row[]
        const rlRows  = (hist.get("sensor.ems_rl_akcja")  ?? []) as Row[]
        const merged = new Map<number, { mpc?: number; rl?: number }>()
        for (const r of mpcRows) {
          const v = parseInt(r.state, 10); const ts = new Date(r.last_changed).getTime()
          if (!isNaN(v) && !isNaN(ts)) merged.set(ts, { ...merged.get(ts), mpc: v })
        }
        for (const r of rlRows) {
          const v = parseInt(r.state, 10); const ts = new Date(r.last_changed).getTime()
          if (!isNaN(v) && !isNaN(ts)) merged.set(ts, { ...merged.get(ts), rl: v })
        }
        const sorted = [...merged.entries()].sort((a, b) => a[0] - b[0])
        let lastMpc = 0, lastRl = 0
        const pts: Point[] = sorted.map(([ts, v]) => {
          lastMpc = v.mpc ?? lastMpc
          lastRl  = v.rl  ?? lastRl
          return { ts, mpc: lastMpc, rl: lastRl }
        })
        const step = Math.max(1, Math.floor(pts.length / 80))
        setData(pts.filter((_, i) => i % step === 0 || i === pts.length - 1))
      } catch {
        // silent
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [])

  if (loading) return <div className="h-[160px] animate-pulse rounded-md bg-muted/40" />
  if (data.length === 0) {
    return (
      <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
        {t("compare.noData")}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data}>
        <XAxis
          dataKey="ts" scale="time" type="number" domain={["auto", "auto"]}
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickFormatter={(v: number) => {
            const d = new Date(v)
            return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
          }}
          axisLine={{ stroke: "var(--border)" }} tickLine={{ stroke: "var(--border)" }}
        />
        <YAxis
          domain={[-0.2, 2.2]} ticks={[0, 1, 2]}
          tickFormatter={(v: number) => actionLabel(v, t)}
          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
          axisLine={false} tickLine={false} width={64}
        />
        <Tooltip
          contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          labelFormatter={(v: number) => new Date(v).toLocaleTimeString()}
          formatter={(v: number, name: string) => [actionLabel(v, t), name]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="stepAfter" dataKey="mpc" name="MPC" stroke="#22d3ee" strokeWidth={2} dot={false} />
        {rlEnabled && (
          <Line type="stepAfter" dataKey="rl" name="RL" stroke="#c084fc" strokeWidth={2} strokeDasharray="5 3" dot={false} />
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── main component ─────────────────────────────────────────────────────────────

export function MpcRlCompare() {
  const { t } = useTranslation()

  const mpcAction = useEntityNum("sensor.ems_mpc_akcja", 0)
  const rlAction  = useEntityNum("sensor.ems_rl_akcja", 0)
  const rlEnabled = useEntityState("sensor.ems_rl_wlaczony") === "True"
  const epsilon   = useEntityNum("sensor.ems_rl_epsilon", 0)
  const ticks     = useEntityNum("sensor.ems_rl_ticks", 0)

  const applied = rlEnabled && rlAction !== 0 ? rlAction : mpcAction
  const agree = mpcAction === rlAction

  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">{t("compare.title")}</h2>
          {rlEnabled
            ? <span className="ml-auto rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">RL ON</span>
            : <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">RL OFF</span>}
        </div>

        {/* Current decisions */}
        <div className="grid grid-cols-3 gap-2">
          <DecisionBadge icon={Cpu} label="MPC" action={mpcAction} t={t} />
          <DecisionBadge icon={Brain} label="RL" action={rlEnabled ? rlAction : 0} t={t} />
          <DecisionBadge icon={Check} label={t("compare.applied")} action={applied} t={t} />
        </div>

        {/* RL training progress */}
        {rlEnabled ? (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{t("compare.exploration")}</span>
              <span className="font-medium tabular-nums">{(epsilon * 100).toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.min(100, epsilon * 100)}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t("compare.ticksTrained", { n: Math.round(ticks).toLocaleString() })}</span>
              <span className={agree ? "text-green-500" : "text-orange-500"}>
                {agree ? t("compare.agree") : t("compare.diverge")}
              </span>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-muted-foreground">{t("compare.rlDisabled")}</p>
        )}

        {/* Decision history chart */}
        <div className="mt-3">
          <p className="mb-1 text-xs text-muted-foreground">{t("compare.history")}</p>
          <DecisionChart rlEnabled={rlEnabled} />
        </div>
      </CardContent>
    </Card>
  )
}
