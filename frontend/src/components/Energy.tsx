import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { MiniChart } from "@/components/charts/MiniChart"
import { StatCard } from "@/components/StatCard"
import { MpcRlCompare } from "@/components/MpcRlCompare"
import { useEntityNum } from "@/hooks/useHA"
import { Wallet, Zap, Sun, Clock } from "lucide-react"

export function Energy() {
  const { t } = useTranslation()
  const pvToday = useEntityNum("sensor.ems_energia_pv_riemann")
  const nettoToday = useEntityNum("sensor.ems_energia_netto_riemann")
  const balance = useEntityNum("sensor.ems_bilans_finansowy_dzis")
  const peakPrice = useEntityNum("sensor.ems_szczyt_cena_dzis")
  const chgStart = useEntityNum("sensor.ems_ladowanie_start_godzina")
  const chgDur = useEntityNum("sensor.ems_ladowanie_czas_trwania")
  const pvTomorrow = useEntityNum("sensor.ems_prognoza_pv_jutro_kwh")
  const ghiTomorrow = useEntityNum("sensor.ems_prognoza_pv_jutro_szczyt_ghi")

  return (
    <div className="space-y-3 sm:space-y-4">
      <h2 className="text-base font-semibold sm:text-lg">{t("energy.title")}</h2>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        <StatCard label={t("energy.pvToday")} value={pvToday.toFixed(2)} unit="kWh" color="#66bb6a" icon={Sun} />
        <StatCard
          label={t("energy.netBalance")}
          value={nettoToday.toFixed(2)}
          unit="kWh"
          color={nettoToday >= 0 ? "#66bb6a" : "#ef5350"}
          icon={Zap}
        />
        <StatCard
          label={t("energy.balance")}
          value={balance.toFixed(2)}
          unit="PLN"
          color={balance >= 0 ? "#66bb6a" : "#ef5350"}
          icon={Wallet}
        />
        <StatCard label={t("energy.peakPrice")} value={String(peakPrice)} unit="gr/kWh" color="#ce93d8" icon={Zap} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("energy.chargeWindow")}</p>
            </div>
            <p>{t("energy.start")}: <strong>{chgStart < 24 ? `${chgStart}:00` : t("energy.none")}</strong></p>
            <p>{t("energy.duration")}: <strong>{chgStart < 24 ? `${(chgDur / 10).toFixed(1)}h` : "-"}</strong></p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sun className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("energy.pvForecast")}</p>
            </div>
            <p>{t("energy.energy")}: <strong>{pvTomorrow > 0 ? `${(pvTomorrow / 10).toFixed(1)} kWh` : t("energy.none")}</strong></p>
            <p>{t("energy.peakGhi")}: <strong>{ghiTomorrow > 0 ? `${ghiTomorrow} W/m²` : t("energy.none")}</strong></p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm text-muted-foreground">{t("energy.details")}</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>sensor.ems_energia_pv_riemann</li>
              <li>sensor.ems_energia_netto_riemann</li>
              <li>sensor.ems_pobor_domu_bazowy</li>
              <li>sensor.sztuczny_stan_baterii_soc</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* MPC vs RL decision comparison (4.2 / 4.4) */}
      <MpcRlCompare />

      <h2 className="text-lg font-semibold">{t("energy.priceHistory")}</h2>

      <Card>
        <CardContent className="p-4">
          <MiniChart entityId="sensor.ems_biezaca_cena_energii" hours={24} color="#ce93d8" />
        </CardContent>
      </Card>
    </div>
  )
}
