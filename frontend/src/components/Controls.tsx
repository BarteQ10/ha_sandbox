import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { useEntityState, useEntityNum, useHA } from "@/hooks/useHA"
import { useCommittedSlider } from "@/hooks/useCommittedSlider"

function ControlSwitch({ label, entityId, domain, serviceOn, serviceOff }: {
  label: string
  entityId: string
  domain: string
  serviceOn: string
  serviceOff: string
}) {
  const state = useEntityState(entityId)
  const { callService } = useHA()
  const checked = state === "on"
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <Label>{label}</Label>
        <Switch
          checked={checked}
          onCheckedChange={() =>
            callService(domain, checked ? serviceOff : serviceOn, { entity_id: entityId })
          }
        />
      </CardContent>
    </Card>
  )
}

function ControlSelect({ label, entityId, options }: { label: string; entityId: string; options: string[] }) {
  const state = useEntityState(entityId)
  const { callService } = useHA()
  const value = options.includes(state) ? state : options[0]
  return (
    <Card>
      <CardContent className="p-4">
        <Label className="mb-2 block">{label}</Label>
        <Select
          value={value}
          onValueChange={(v) =>
            callService("input_select", "select_option", { entity_id: entityId, option: v })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
}

function ControlSlider({ label, entityId, min, max, step, unit }: {
  label: string; entityId: string; min: number; max: number; step: number; unit: string
}) {
  const { callService } = useHA()
  const { display, sliderProps } = useCommittedSlider(useEntityNum(entityId), (v) =>
    callService("input_number", "set_value", { entity_id: entityId, value: v })
  )
  return (
    <Card>
      <CardContent className="p-4">
        <Label className="mb-2 block">{label}: {display} {unit}</Label>
        <Slider min={min} max={max} step={step} {...sliderProps} />
      </CardContent>
    </Card>
  )
}

export function Controls() {
  const { callService } = useHA()
  const { t } = useTranslation()
  const stormOn = useEntityState("input_boolean.ems_storm_safeguard") === "on"
  const evOn = useEntityState("input_boolean.ems_ev_override") === "on"

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t("controls.title")}</h2>

      <div className="grid gap-3 md:grid-cols-3">
        <ControlSelect
          label={t("controls.inverterMode")}
          entityId="input_select.ems_tryb_inwertera"
          options={["Auto", "Force Charge", "Force Discharge"]}
        />
        <ControlSelect
          label={t("controls.heatPumpMode")}
          entityId="input_select.ems_tryb_pompy_ciepla"
          options={["Wylaczona", "Komfort", "Boost"]}
        />
        <ControlSelect
          label={t("controls.gridStatus")}
          entityId="input_select.ems_status_sieci"
          options={["Normal", "Blackout", "Fluktuacje"]}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <ControlSwitch
          label={t("controls.boiler")}
          entityId="input_boolean.wirtualny_bojler"
          domain="input_boolean"
          serviceOn="turn_on"
          serviceOff="turn_off"
        />
        <ControlSwitch
          label={t("controls.pvLimit")}
          entityId="switch.ems_ograniczenie_pv"
          domain="switch"
          serviceOn="turn_on"
          serviceOff="turn_off"
        />
        <ControlSwitch
          label={t("controls.apiAnomaly")}
          entityId="input_boolean.ems_symuluj_awarie_api"
          domain="input_boolean"
          serviceOn="turn_on"
          serviceOff="turn_off"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className={`border-2 ${stormOn ? "border-red-500" : "border-gray-700"}`}>
          <CardContent className="p-4 text-center">
            <p className="mb-3 font-medium">{t("controls.stormSafeguard")}</p>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() =>
                callService("input_boolean", "turn_on", { entity_id: "input_boolean.ems_storm_safeguard" })
              }
            >
              {t("controls.stormActivate")}
            </Button>
            <Button
              variant="outline"
              className="mt-2 w-full"
              onClick={() =>
                callService("input_boolean", "turn_off", { entity_id: "input_boolean.ems_storm_safeguard" })
              }
            >
              {t("controls.stormDeactivate")}
            </Button>
          </CardContent>
        </Card>

        <Card className={`border-2 ${evOn ? "border-orange-500" : "border-gray-700"}`}>
          <CardContent className="p-4 text-center">
            <p className="mb-3 font-medium">{t("controls.evOverride")}</p>
            <Button
              variant={evOn ? "secondary" : "default"}
              className="w-full"
              onClick={() =>
                callService("input_boolean", "turn_on", { entity_id: "input_boolean.ems_ev_override" })
              }
            >
              {t("controls.evOn")}
            </Button>
            <Button
              variant="outline"
              className="mt-2 w-full"
              onClick={() =>
                callService("input_boolean", "turn_off", { entity_id: "input_boolean.ems_ev_override" })
              }
            >
              {t("controls.evAuto")}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ControlSlider
          label={t("controls.evLimit")}
          entityId="input_number.ems_limit_ladowania_ev"
          min={0} max={7400} step={100} unit="W"
        />
        <ControlSlider
          label={t("controls.degradationCost")}
          entityId="input_number.ems_koszt_degradacji_baterii"
          min={0} max={50} step={1} unit="gr/kWh"
        />
      </div>
    </div>
  )
}
