import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { fetchHistory } from "@/api/haClient"
import { isNumericSeries, toNumericPoints, toSegments, stateColor, type HistRow } from "@/lib/history"

const TOOLTIP_STYLE = {
  background: "var(--popover)", border: "1px solid var(--border)",
  borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)",
}

export function EntityHistory({ entityId, hours }: { entityId: string; hours: number }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<HistRow[]>([])
  const [loading, setLoading] = useState(true)
  const [end, setEnd] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const e = Date.now()
    const s = e - hours * 3600_000
    fetchHistory(entityId, new Date(s).toISOString(), new Date(e).toISOString())
      .then((r) => { if (!cancelled) { setRows(r); setEnd(e); setLoading(false) } })
      .catch(() => { if (!cancelled) { setRows([]); setLoading(false) } })
    return () => { cancelled = true }
  }, [entityId, hours])

  const fmtTime = (v: unknown) => new Date(Number(v)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  if (loading) return <p className="py-6 text-center text-xs text-muted-foreground">{t("history.loading")}</p>
  if (rows.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{t("history.empty")}</p>

  // ── numeric series → area chart ─────────────────────────────────────────────
  if (isNumericSeries(rows)) {
    const data = toNumericPoints(rows)
    return (
      <div className="h-44 w-full">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -12 }}>
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]}
                   tickFormatter={fmtTime} tick={{ fontSize: 10 }} minTickGap={48} />
            <YAxis tick={{ fontSize: 10 }} width={36} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelFormatter={(v) => fmtTime(v)}
              formatter={(v) => [Number(v).toFixed(1), entityId.split(".").pop() ?? ""]}
            />
            <Area type="monotone" dataKey="v" stroke="var(--primary)" fill="var(--primary)"
                  fillOpacity={0.15} strokeWidth={2} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )
  }

  // ── discrete states → coloured timeline strip ───────────────────────────────
  const startMs = end - hours * 3600_000
  const windowMs = Math.max(1, end - startMs)
  const segs = toSegments(rows, end)
  const distinct = Array.from(new Set(segs.map((s) => s.state)))
  const fmtFull = (ms: number) => new Date(ms).toLocaleString()

  return (
    <div className="space-y-2 py-2">
      <div className="flex h-8 w-full overflow-hidden rounded border">
        {segs.map((s, i) => (
          <div
            key={i}
            title={`${s.state} · ${fmtFull(s.start)} → ${fmtFull(s.end)}`}
            style={{ width: `${((s.end - s.start) / windowMs) * 100}%`, backgroundColor: stateColor(s.state) }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {distinct.map((st) => (
          <span key={st} className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: stateColor(st) }} />
            {st}
          </span>
        ))}
      </div>
    </div>
  )
}
