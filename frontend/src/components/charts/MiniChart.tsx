import { useEffect, useState } from "react"
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts"
import { fetchHistory } from "@/api/haClient"

interface DataPoint {
  ts: number
  value: number
}

export function MiniChart({
  entityId, hours = 12, color = "#4fc3f7",
}: {
  entityId: string; hours?: number; color?: string
}) {
  const [data, setData] = useState<DataPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      try {
        const end = new Date().toISOString()
        const start = new Date(Date.now() - hours * 3600_000).toISOString()
        const rows = await fetchHistory(entityId, start, end)
        if (ignore) return
        const pts: DataPoint[] = []
        for (const r of rows) {
          const v = parseFloat(r.state)
          const t = new Date(r.last_changed).getTime()
          if (!isNaN(v) && !isNaN(t)) {
            pts.push({ ts: t, value: v })
          }
        }
        const step = Math.max(1, Math.floor(pts.length / 60))
        setData(pts.filter((_, i) => i % step === 0 || i === pts.length - 1))
      } catch {
        // silently fail
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => {
      ignore = true
    }
  }, [entityId, hours])

  if (loading) {
    return <div className="h-[150px] animate-pulse rounded-md bg-muted/40" />
  }

  if (data.length === 0) {
    return (
      <div className="flex h-[150px] items-center justify-center text-sm text-muted-foreground">
        No data
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={150}>
      <LineChart data={data}>
        <XAxis
          dataKey="ts"
          scale="time"
          domain={['auto', 'auto']}
          type="number"
          tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          tickFormatter={(v: number) => {
            const d = new Date(v)
            return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
          }}
          axisLine={{ stroke: "var(--border)" }}
          tickLine={{ stroke: "var(--border)" }}
        />
        <YAxis domain={["auto", "auto"]} tick={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--popover-foreground)",
          }}
          labelFormatter={(v: number) => new Date(v).toLocaleTimeString()}
        />
        <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
