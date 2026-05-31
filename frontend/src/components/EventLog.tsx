import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { fetchEvents, type LogEvent, type EventsResponse } from "@/api/events"
import {
  Activity, ScrollText, ShieldAlert, Zap, Tv, Plug, RefreshCw, Pause, Play,
  CalendarSearch, Radio,
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

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export function EventLog() {
  const { t } = useTranslation()
  const [data, setData] = useState<EventsResponse | null>(null)
  const [category, setCategory] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  // History mode: when set, query a date range from InfluxDB (live feed paused)
  const [history, setHistory] = useState(false)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState(todayISO())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (cat: string, range?: { from: string; to: string }) => {
    try {
      const opts: Parameters<typeof fetchEvents>[0] = { limit: 500, category: cat }
      if (range?.from) {
        opts.from = new Date(`${range.from}T00:00:00`).toISOString()
        opts.to = new Date(`${range.to}T23:59:59`).toISOString()
      }
      const res = await fetchEvents(opts)
      setData(res)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // initial + on category change (live mode only — history loads on demand)
  useEffect(() => {
    if (history) return
    setLoading(true); load(category)
  }, [category, load, history])

  // auto-refresh (live mode only)
  useEffect(() => {
    if (history || !autoRefresh) {
      if (timer.current) clearInterval(timer.current)
      return
    }
    timer.current = setInterval(() => load(category), REFRESH_MS)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [autoRefresh, category, load, history])

  function loadHistory() {
    if (!fromDate) return
    setHistory(true)
    setLoading(true)
    load(category, { from: fromDate, to: toDate || todayISO() })
  }

  function backToLive() {
    setHistory(false)
    setLoading(true)
    // live effect re-fires via the `history` dependency
  }

  // Re-query history when the category changes while in history mode
  useEffect(() => {
    if (history && fromDate) {
      setLoading(true)
      load(category, { from: fromDate, to: toDate || todayISO() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  const events = data?.events ?? []
  const total = data?.stats.total ?? 0
  const byCat = data?.stats.by_category ?? {}
  const CATS = ["all", "anomaly", "rule", "security", "energy", "media", "grid"]

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold sm:text-lg">{t("events.title")}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{total}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
          history ? "bg-blue-500/15 text-blue-600 dark:text-blue-400" : "bg-green-500/15 text-green-600 dark:text-green-400"
        }`}>
          {history ? t("events.modeHistory") : t("events.modeLive")}
        </span>
        <div className="ml-auto flex gap-1">
          {!history && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => setAutoRefresh((v) => !v)}
              aria-label={autoRefresh ? t("events.pause") : t("events.resume")}
              title={autoRefresh ? t("events.pause") : t("events.resume")}
            >
              {autoRefresh ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
          )}
          <Button
            variant="ghost" size="icon" className="h-8 w-8"
            onClick={() => { setLoading(true); history ? load(category, { from: fromDate, to: toDate || todayISO() }) : load(category) }}
            aria-label={t("events.refresh")} title={t("events.refresh")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Date-range history picker */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/40 px-3 py-2">
        <CalendarSearch className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          type="date" value={fromDate} max={toDate || todayISO()}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-xs"
          aria-label={t("events.from")}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <input
          type="date" value={toDate} max={todayISO()}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-md border bg-background px-2 py-1 text-xs"
          aria-label={t("events.to")}
        />
        <Button size="sm" className="h-7 gap-1.5 text-xs" disabled={!fromDate} onClick={loadHistory}>
          <CalendarSearch className="h-3.5 w-3.5" />
          {t("events.loadHistory")}
        </Button>
        {history && (
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={backToLive}>
            <Radio className="h-3.5 w-3.5" />
            {t("events.backToLive")}
          </Button>
        )}
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

      <p className="text-center text-[10px] text-muted-foreground">
        {history ? t("events.noteHistory") : t("events.note")}
      </p>
    </div>
  )
}
