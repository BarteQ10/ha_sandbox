import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Area, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { fetchAdvisor, type Advisor as AdvisorData, type AdvRec } from "@/api/advisor"
import { WashingMachine, Utensils, Car, Sparkles, RefreshCw, Sun, Banknote } from "lucide-react"

const ICON: Record<string, React.ElementType> = { washer: WashingMachine, dishwasher: Utensils, ev: Car }
const fmtH = (h: number) => `${String(h).padStart(2, "0")}:00`
const zl = (gr: number) => (gr / 100).toFixed(2)

function RecCard({ rec }: { rec: AdvRec }) {
  const { t } = useTranslation()
  const Icon = ICON[rec.name] ?? Sparkles
  const saved = rec.saving_gr > 0
  return (
    <Card>
      <CardContent className="space-y-2 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">{t(`advisor.${rec.name}`)}</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {(rec.power_w / 1000).toFixed(1)} kW · {rec.duration_h} h
          </span>
        </div>
        <div className="flex items-end gap-2">
          <span className="text-2xl font-bold tabular-nums text-primary">{fmtH(rec.best_hour)}</span>
          <span className="mb-1 text-xs text-muted-foreground">
            {t("advisor.cost")} {zl(rec.cost_gr)} zł
          </span>
        </div>
        <p className="text-xs" style={{ color: saved ? "#4ade80" : "var(--muted-foreground)" }}>
          {saved
            ? <><Banknote className="mr-1 inline h-3.5 w-3.5" />{t("advisor.saving", { zl: zl(rec.saving_gr) })}</>
            : t("advisor.alreadyGood")}
        </p>
      </CardContent>
    </Card>
  )
}

export function Advisor() {
  const { t } = useTranslation()
  const [data, setData] = useState<AdvisorData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => { setLoading(true); fetchAdvisor().then((d) => { setData(d); setLoading(false) }) }
  useEffect(load, [])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold sm:text-lg">{t("advisor.title")}</h2>
        <Button variant="ghost" size="sm" className="ml-auto h-7 px-2" onClick={load} aria-label={t("advisor.refresh")}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {loading && <p className="text-xs text-muted-foreground">{t("advisor.loading")}</p>}
      {!loading && !data && <p className="text-xs text-muted-foreground">{t("advisor.error")}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.recommendations.map((r) => <RecCard key={r.name} rec={r} />)}
          </div>

          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="mb-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><Banknote className="h-3.5 w-3.5 text-amber-500" />{t("advisor.price")}</span>
                <span className="flex items-center gap-1"><Sun className="h-3.5 w-3.5 text-green-500" />{t("advisor.pv")}</span>
              </div>
              <div className="w-full">
                <ResponsiveContainer width="100%" height={224}>
                  <ComposedChart data={data.hours} margin={{ top: 5, right: 8, bottom: 0, left: -8 }}>
                    <XAxis dataKey="hour" tickFormatter={(h) => `${h}`} tick={{ fontSize: 10 }} minTickGap={16} />
                    <YAxis yAxisId="pv" tick={{ fontSize: 10 }} width={40} />
                    <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 10 }} width={36} />
                    <Tooltip
                      contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                      labelFormatter={(h) => fmtH(Number(h))}
                      formatter={(v, name) => [Number(v).toFixed(0), name === "pv_w" ? t("advisor.pv") : t("advisor.price")]}
                    />
                    <Area yAxisId="pv" type="monotone" dataKey="pv_w" stroke="#22c55e" fill="#22c55e" fillOpacity={0.15} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line yAxisId="price" type="monotone" dataKey="price_gr" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-[10px] text-muted-foreground">{t("advisor.note")}</p>
        </>
      )}
    </div>
  )
}
