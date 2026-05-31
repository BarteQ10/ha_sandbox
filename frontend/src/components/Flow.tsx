import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { FlowGauge } from "@/components/charts/FlowGauge"
import { MiniChart } from "@/components/charts/MiniChart"
import { StatCard } from "@/components/StatCard"
import { useEntityNum, useEntityState } from "@/hooks/useHA"
import { ArrowDown, ArrowUp, Wallet, Zap } from "lucide-react"
import { EnergyFlow } from "@/components/EnergyFlow"

function EntityBadge({ label, state }: { label: string; state: string }) {
  const on = state === "on" || state === "1" || state === "Boost" || state === "Komfort"
  return (
    <Card className={`border-l-4 ${on ? "border-l-green-500" : "border-l-gray-600"}`}>
      <CardContent className="p-3 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-sm font-semibold ${on ? "text-green-400" : "text-gray-400"}`}>{state}</p>
      </CardContent>
    </Card>
  )
}

export function Flow() {
  const { t } = useTranslation()
  const pv = useEntityNum("sensor.sztuczna_produkcja_pv")
  const soc = useEntityNum("sensor.sztuczny_stan_baterii_soc")
  const load = useEntityNum("sensor.ems_pobor_domu_bazowy")
  const price = useEntityNum("sensor.ems_biezaca_cena_energii")
  const balance = useEntityNum("sensor.ems_bilans_finansowy_dzis")
  const boiler = useEntityState("input_boolean.wirtualny_bojler")
  const hpMode = useEntityState("input_select.ems_tryb_pompy_ciepla")
  const evLimit = useEntityNum("input_number.ems_limit_ladowania_ev")
  const inverter = useEntityState("input_select.ems_tryb_inwertera")
  const grid = useEntityState("input_select.ems_status_sieci")

  const net = pv - load
  const importW = net < 0 ? -net : 0
  const exportW = net > 0 ? net : 0
  // Battery flow: positive = charging (PV surplus), negative = discharging
  const battFlow = net   // simplified: positive balance charges battery

  return (
    <div className="space-y-3 sm:space-y-4">
      <h2 className="text-base font-semibold sm:text-lg">{t("flow.title")}</h2>

      {/* Animated energy-flow diagram (5.4) */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <EnergyFlow
            pv={pv}
            soc={soc}
            load={load}
            battKw={battFlow}
            importW={importW}
            exportW={exportW}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <FlowGauge label={t("flow.pv")} value={pv} max={5500} unit="W" color="#66bb6a" />
        <FlowGauge label={t("flow.battery")} value={soc} max={100} unit="%" color="#4fc3f7" />
        <FlowGauge label={t("flow.load")} value={load} max={10000} unit="W" color="#ffa726" />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
        <StatCard label={t("flow.import")} value={String(importW)} unit="W" color="#ef5350" icon={ArrowDown} />
        <StatCard label={t("flow.export")} value={String(exportW)} unit="W" color="#66bb6a" icon={ArrowUp} />
        <StatCard
          label={t("flow.balance")}
          value={balance.toFixed(2)}
          unit="PLN"
          color={balance >= 0 ? "#66bb6a" : "#ef5350"}
          icon={Wallet}
        />
        <StatCard label={t("flow.price")} value={String(price)} unit="gr/kWh" color="#ce93d8" icon={Zap} />
      </div>

      <h2 className="text-base font-semibold sm:text-lg">{t("flow.devices")}</h2>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-5">
        <EntityBadge label={t("flow.boiler")} state={boiler === "on" ? t("flow.on") : t("flow.off")} />
        <EntityBadge label={t("flow.heatPump")} state={hpMode} />
        <EntityBadge label={t("flow.ev")} state={evLimit > 0 ? `${evLimit}W` : t("flow.off")} />
        <EntityBadge label={t("flow.inverter")} state={inverter} />
        <EntityBadge label={t("flow.grid")} state={grid} />
      </div>

      <h2 className="text-lg font-semibold">{t("flow.history")}</h2>

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm text-muted-foreground">{t("flow.pvHistory")}</p>
            <MiniChart entityId="sensor.sztuczna_produkcja_pv" hours={12} color="#66bb6a" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm text-muted-foreground">{t("flow.batteryHistory")}</p>
            <MiniChart entityId="sensor.sztuczny_stan_baterii_soc" hours={12} color="#4fc3f7" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
