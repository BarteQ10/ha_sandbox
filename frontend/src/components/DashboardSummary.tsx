import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { useEntityNum } from "@/hooks/useHA"
import { useWeekReport, weekTotals } from "@/hooks/useWeekReport"
import {
  Sun, Battery, Wallet, Recycle, HeartPulse, Zap, Home as HomeIcon,
} from "lucide-react"

// ─── single KPI tile ───────────────────────────────────────────────────────────

function Kpi({ icon: Icon, label, value, unit, color, sub, onClick }: {
  icon: React.ElementType
  label: string
  value: string
  unit?: string
  color?: string
  sub?: string
  onClick?: () => void
}) {
  const interactive = Boolean(onClick)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`flex flex-col gap-1 rounded-xl border bg-card/60 p-3 text-left backdrop-blur ${
        interactive
          ? "cursor-pointer transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "cursor-default"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-end gap-1">
        <span className="text-lg font-bold tabular-nums leading-none sm:text-xl" style={{ color }}>
          {value}
        </span>
        {unit && <span className="mb-0.5 text-[10px] text-muted-foreground">{unit}</span>}
      </div>
      {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
    </button>
  )
}

// ─── battery SoH colour ─────────────────────────────────────────────────────────

function sohColor(pct: number) {
  if (pct >= 90) return "#4ade80"
  if (pct >= 80) return "#fbbf24"
  return "#f87171"
}

// ─── component ───────────────────────────────────────────────────────────────────

// "bar"  → horizontal strip across the top (up to 6 columns)
// "side" → narrow left sidebar; tiles stack into a single column on desktop
type SummaryVariant = "bar" | "side"

export function DashboardSummary({ variant = "bar", onNavigate }: {
  variant?: SummaryVariant
  // Jump to a System sub-tab when a KPI tile is clicked (e.g. "energy",
  // "reports", "flow"). When omitted, tiles render as plain, non-clickable cards.
  onNavigate?: (sysTab: string) => void
}) {
  const { t } = useTranslation()
  const nav = (sysTab: string) => (onNavigate ? () => onNavigate(sysTab) : undefined)

  // Live values
  const pv        = useEntityNum("sensor.sztuczna_produkcja_pv", 0)
  const load      = useEntityNum("sensor.ems_pobor_domu_bazowy", 0)
  const soc       = useEntityNum("sensor.sztuczny_stan_baterii_soc", 0)
  const balToday  = useEntityNum("sensor.ems_bilans_finansowy_dzis", 0)
  const sohRaw    = useEntityNum("sensor.ems_battery_soh", 1)   // 0-1 fraction

  // Weekly aggregates (current week)
  const { rows, loading } = useWeekReport(0)
  const { totalPv, totalCost, avgSelf } = weekTotals(rows)

  const sohPct = Math.round(sohRaw * 1000) / 10   // e.g. 0.982 → 98.2
  const netNow = pv - load

  // Tile grid: "bar" spreads across the top; "side" collapses to one column
  // once there's a desktop sidebar to live in.
  const tileGrid = variant === "side"
    ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1"
    : "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"

  return (
    <Card className="border-primary/20">
      <CardContent className="p-3 sm:p-4">
        <div className="mb-2 flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t("summary.title")}</h2>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {netNow >= 0
              ? t("summary.surplus", { w: Math.round(netNow) })
              : t("summary.deficit", { w: Math.round(-netNow) })}
          </span>
        </div>

        <div className={tileGrid}>
          {/* Live → power flow */}
          <Kpi
            icon={Sun} label={t("summary.pvNow")}
            value={String(Math.round(pv))} unit="W" color="#66bb6a"
            onClick={nav("flow")}
          />
          <Kpi
            icon={HomeIcon} label={t("summary.loadNow")}
            value={String(Math.round(load))} unit="W" color="#ffa726"
            onClick={nav("flow")}
          />
          <Kpi
            icon={Battery} label={t("summary.soc")}
            value={String(Math.round(soc))} unit="%" color="#4fc3f7"
            onClick={nav("energy")}
          />
          {/* Health / finance */}
          <Kpi
            icon={HeartPulse} label={t("summary.soh")}
            value={sohPct.toFixed(1)} unit="%" color={sohColor(sohPct)}
            sub={t("summary.sohSub")}
            onClick={nav("energy")}
          />
          <Kpi
            icon={Wallet} label={t("summary.balanceToday")}
            value={(balToday >= 0 ? "+" : "") + balToday.toFixed(2)} unit="PLN"
            color={balToday >= 0 ? "#4ade80" : "#f87171"}
            onClick={nav("reports")}
          />
          <Kpi
            icon={Recycle} label={t("summary.selfWeek")}
            value={loading ? "…" : avgSelf.toFixed(0)} unit="%"
            color="#a78bfa"
            sub={loading ? undefined : t("summary.weekPv", { kwh: totalPv.toFixed(1) })}
            onClick={nav("reports")}
          />
        </div>

        {/* Weekly savings line */}
        {!loading && (
          <div className="mt-2 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <span>{t("summary.weekBalance")}:</span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: totalCost >= 0 ? "#4ade80" : "#f87171" }}
            >
              {(totalCost >= 0 ? "+" : "") + totalCost.toFixed(2)} PLN
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
