import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { useEntityNum, useHA } from "@/hooks/useHA"
import { Settings2, Battery, Sun, Zap, MapPin, Clock } from "lucide-react"

const LAT = import.meta.env.VITE_LAT ?? "52.23"
const LON = import.meta.env.VITE_LON ?? "21.01"

// ─── Editable threshold row ──────────────────────────────────────────────────

function ThresholdSlider({
  label, description, entityId, min, max, step, unit,
}: {
  label: string; description: string; entityId: string
  min: number; max: number; step: number; unit: string
}) {
  const { callService } = useHA()
  const entityValue = useEntityNum(entityId, min)
  // Local state tracks slider drag; resets to entity value on blur / explicit save.
  const [local, setLocal] = useState<number | null>(null)
  const display = local ?? entityValue

  function save(v: number) {
    const clamped = Math.min(max, Math.max(min, Math.round(v / step) * step))
    setLocal(null)
    callService("input_number", "set_value", { entity_id: entityId, value: clamped })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {/* +/- buttons give an always-reliable explicit save path */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full border text-sm hover:bg-accent"
            onClick={() => save(display - step)}
          >−</button>
          <span className="min-w-[5ch] text-center text-sm font-semibold tabular-nums">
            {display.toLocaleString()}
          </span>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-full border text-sm hover:bg-accent"
            onClick={() => save(display + step)}
          >+</button>
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
      </div>
      <Slider
        min={min} max={max} step={step}
        value={[display]}
        onValueChange={([v]) => setLocal(v)}
        onValueCommit={([v]) => save(v)}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{min.toLocaleString()} {unit}</span>
        <span>{max.toLocaleString()} {unit}</span>
      </div>
    </div>
  )
}

// ─── Read-only info row ───────────────────────────────────────────────────────

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm border-b last:border-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </div>
      <span className="font-medium">{value}</span>
    </div>
  )
}

// ─── Distribution tariff table ────────────────────────────────────────────────

const TARIFF_ZONES = [
  { hours: "0 – 6",   rate: 12, peak: false },
  { hours: "6 – 13",  rate: 28, peak: true  },
  { hours: "13 – 15", rate: 12, peak: false },
  { hours: "15 – 22", rate: 28, peak: true  },
  { hours: "22 – 24", rate: 12, peak: false },
]

// ─── Main component ───────────────────────────────────────────────────────────

export function Settings() {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">

      {/* EMS Thresholds */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">{t("settings.thresholds")}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 px-4 pb-4">
          <ThresholdSlider
            label={t("settings.peakShaving")}
            description={t("settings.peakShavingDesc")}
            entityId="input_number.ems_max_pobor_sieci"
            min={1000} max={15000} step={500} unit="W"
          />
          <ThresholdSlider
            label={t("settings.degradationCost")}
            description={t("settings.degradationCostDesc")}
            entityId="input_number.ems_koszt_degradacji_baterii"
            min={0} max={50} step={1} unit="gr/kWh"
          />
          <ThresholdSlider
            label={t("settings.evLimit")}
            description={t("settings.evLimitDesc")}
            entityId="input_number.ems_limit_ladowania_ev"
            min={0} max={7400} step={100} unit="W"
          />
        </CardContent>
      </Card>

      {/* System configuration */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-semibold">{t("settings.systemConfig")}</p>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <InfoRow
            icon={<Sun className="h-3.5 w-3.5" />}
            label={t("settings.pvPeak")}
            value="5 kWp · 5000 W inverter"
          />
          <InfoRow
            icon={<Battery className="h-3.5 w-3.5" />}
            label={t("settings.batterySize")}
            value="15 kWh LiFePO₄"
          />
          <InfoRow
            icon={<Zap className="h-3.5 w-3.5" />}
            label={t("settings.inverterEff")}
            value="92 %"
          />
          <InfoRow
            icon={<Clock className="h-3.5 w-3.5" />}
            label={t("settings.simSpeed")}
            value={t("settings.simSpeedValue")}
          />
          <InfoRow
            icon={<MapPin className="h-3.5 w-3.5" />}
            label={t("settings.location")}
            value={`${LAT}° N, ${LON}° E`}
          />
        </CardContent>
      </Card>

      {/* Distribution tariff */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <p className="text-sm font-semibold">{t("settings.tariff")}</p>
          <p className="text-xs text-muted-foreground">{t("settings.tariffDesc")}</p>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="overflow-hidden rounded-md border text-sm">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">{t("settings.tariffHours")}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("settings.tariffRate")}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">{t("settings.tariffZone")}</th>
                </tr>
              </thead>
              <tbody>
                {TARIFF_ZONES.map((z) => (
                  <tr key={z.hours} className="border-t">
                    <td className="px-3 py-2 tabular-nums">{z.hours}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {z.rate} gr/kWh
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        z.peak
                          ? "bg-orange-500/15 text-orange-600 dark:text-orange-400"
                          : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                      }`}>
                        {z.peak ? t("settings.tariffPeak") : t("settings.tariffOffPeak")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{t("settings.tariffNote")}</p>
        </CardContent>
      </Card>

    </div>
  )
}
