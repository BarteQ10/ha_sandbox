import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { fetchEvents, type LogEvent, type EventsResponse } from "@/api/events"
import {
  Activity, ScrollText, ShieldAlert, Zap, Tv, Plug, RefreshCw, Pause, Play,
} from "lucide-react"

// ─── category metadata ──────────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { icon: React.ElementType; color: string }> = {
  anomaly:  { icon: Activity,    color: "#fbbf24" },
  rule:     { icon: ScrollText,  color: "#60a5fa" },
  security: { icon: ShieldAlert, color: "#f87171" },
  energy:   { icon: Plug,        color: "#a78bfa" },
  media:    { icon: Tv,          color: "#34d399" },
  grid:     { icon: Zap,         color: "#fb923c" },
}

const SEVERITY_CLASS: Record<string, string> = {
  info:     "border-l-blue-500/50",
  warning:  "border-l-yellow-500/70",
  critical: "border-l-red-500/80",
}

function relativeTime(ts: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (s < 60) return t("events.justNow")
  if (s < 3600) return t("events.minAgo", { n: Math.floor(s / 60) })
  if (s < 86400) return t("events.hourAgo", { n: Math.floor(s / 3600) })
  return t("events.dayAgo", { n: Math.floor(s / 86400) })
}

// ─── single row ──────────────────────────────────────────────────────────────────

function EventRow({ ev, t }: { ev: LogEvent; t: (k: string, o?: Record<string, unknown>) => string }) {
  const meta = CATEGORY_META[ev.category] ?? CATEGORY_META.rule
  const Icon = meta.icon
  return (
    <div className={`flex items-start gap-3 border-l-2 ${SEVERITY_CLASS[ev.severity] ?? ""} bg-card/40 px-3 py-2`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: meta.color }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{ev.message}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="uppercase tracking-wide" style={{ color: meta.color }}>{t(`events.cat.${ev.category}`)}</span>
          <span>·</span>
          <span>{new Date(ev.ts * 1000).toLocaleTimeString()}</span>
          <span>·</span>
          <span>{relativeTime(ev.ts, t)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── main component ─────────────────────────────────────────────────────────────

const REFRESH_MS = 10_000

export function EventLog() {
  const { t } = useTranslation()
  const [data, setData] = useState<EventsResponse | null>(null)
  const [category, setCategory] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (cat: string) => {
    try {
      const res = await fetchEvents({ limit: 200, category: cat })
      setData(res)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // initial + on category change
  useEffect(() => { setLoading(true); load(category) }, [category, load])

  // auto-refresh
  useEffect(() => {
    if (!autoRefresh) {
      if (timer.current) clearInterval(timer.current)
      return
    }
    timer.current = setInterval(() => load(category), REFRESH_MS)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [autoRefresh, category, load])

  const events = data?.events ?? []
  const total = data?.stats.total ?? 0
  const byCat = data?.stats.by_category ?? {}
  const CATS = ["all", "anomaly", "rule", "security", "energy", "media", "grid"]

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold sm:text-lg">{t("events.title")}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{total}</span>
        <div className="ml-auto flex gap-1">
          <Button
            variant="ghost" size="icon" className="h-8 w-8"
            onClick={() => setAutoRefresh((v) => !v)}
            aria-label={autoRefresh ? t("events.pause") : t("events.resume")}
            title={autoRefresh ? t("events.pause") : t("events.resume")}
          >
            {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost" size="icon" className="h-8 w-8"
            onClick={() => { setLoading(true); load(category) }}
            aria-label={t("events.refresh")} title={t("events.refresh")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1">
        {CATS.map((c) => {
          const active = category === c
          const count = c === "all" ? total : (byCat[c] ?? 0)
          return (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                active ? "bg-primary text-primary-foreground" : "border hover:bg-accent"
              }`}
            >
              {t(`events.cat.${c}`)}
              <span className={`ml-1 ${active ? "opacity-80" : "text-muted-foreground"}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="space-y-px p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted/40" />
              ))}
            </div>
          ) : error ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("events.error")}</p>
          ) : events.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t("events.empty")}</p>
          ) : (
            <div className="max-h-[60vh] divide-y overflow-y-auto">
              {events.map((ev) => <EventRow key={ev.id} ev={ev} t={t} />)}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground">{t("events.note")}</p>
    </div>
  )
}
