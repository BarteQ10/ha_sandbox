import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useHA } from "@/hooks/useHA"
import { EntityHistory } from "@/components/EntityHistory"
import { History } from "lucide-react"

const HIST_DOMAINS = ["binary_sensor", "input_boolean", "light", "switch", "lock", "cover", "climate", "fan", "vacuum"]
const SENSOR_CLASSES = ["temperature", "humidity", "carbon_dioxide", "pm25", "battery", "power"]
const RANGES = [{ h: 6, k: "6h" }, { h: 24, k: "24h" }, { h: 168, k: "7d" }]

export function Timeline() {
  const { t } = useTranslation()
  const { entities } = useHA()

  const name = (id: string) => (entities[id]?.attributes?.friendly_name as string) ?? id
  const options = Object.values(entities)
    .filter((e) => {
      const d = e.entity_id.split(".")[0]
      if (HIST_DOMAINS.includes(d)) return true
      if (e.entity_id.startsWith("input_number.wirtualna_temp_")) return true
      if (d === "sensor" && SENSOR_CLASSES.includes((e.attributes?.device_class as string) ?? "")) return true
      return false
    })
    .sort((a, b) => name(a.entity_id).localeCompare(name(b.entity_id)))

  const [entityId, setEntityId] = useState(options[0]?.entity_id ?? "")
  const [hours, setHours] = useState(24)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-base font-semibold sm:text-lg">{t("history.title")}</h2>
      </div>

      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none"
              aria-label={t("history.pick")}
            >
              {options.map((e) => (
                <option key={e.entity_id} value={e.entity_id}>{name(e.entity_id)}</option>
              ))}
            </select>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <Button
                  key={r.k}
                  variant={hours === r.h ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setHours(r.h)}
                >
                  {r.k}
                </Button>
              ))}
            </div>
          </div>

          {entityId
            ? <EntityHistory entityId={entityId} hours={hours} />
            : <p className="py-6 text-center text-xs text-muted-foreground">{t("history.empty")}</p>}
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground">{t("history.note")}</p>
    </div>
  )
}
