import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useHA, useEntitiesByDomain } from "@/hooks/useHA"
import { useToast } from "@/hooks/useToast"
import { triggerAlarm, type AlarmKind } from "@/api/devices"
import {
  CoverControl, LockControl, ClimateControl, BinaryChip, SensorTile, ENV_CLASSES,
} from "@/components/DeviceControls"
import { ROOM_DEVICE_IDS } from "@/components/Rooms"

// ─── container ────────────────────────────────────────────────────────────────

function Section({ title, count, children }: {
  title: string; count: number; children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{count}</span>
      </div>
      {children}
    </div>
  )
}

function TestAlarmsRow() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const fire = async (type: AlarmKind) => {
    const ok = await triggerAlarm(type)
    toast(ok ? t("devices.testTriggered") : t("devices.testFailed"), ok ? "success" : "error")
  }
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <h3 className="text-sm font-semibold">{t("devices.testAlarms")}</h3>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => fire("smoke")}>{t("devices.testSmoke")}</Button>
        <Button variant="outline" size="sm" onClick={() => fire("co")}>{t("devices.testCo")}</Button>
        <Button variant="outline" size="sm" onClick={() => fire("leak")}>{t("devices.testLeak")}</Button>
      </div>
      <p className="text-[10px] text-muted-foreground">{t("devices.testHint")}</p>
    </div>
  )
}

export function Devices() {
  const { t } = useTranslation()
  const { entities } = useHA()

  // Devices assigned to a specific room are rendered inside that room card
  // (Rooms.tsx) — exclude them here so this house-wide view doesn't duplicate them.
  const houseWide = (id: string) => !ROOM_DEVICE_IDS.has(id)

  const covers   = useEntitiesByDomain("cover").filter(houseWide)
  const locks    = useEntitiesByDomain("lock").filter(houseWide)
  const climates = useEntitiesByDomain("climate").filter(houseWide)

  const binaries = Object.values(entities)
    .filter((e) => e.entity_id.startsWith("binary_sensor.") && houseWide(e.entity_id))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
  const envSensors = Object.values(entities)
    .filter((e) => e.entity_id.startsWith("sensor.") &&
      ENV_CLASSES.has((e.attributes.device_class as string) ?? "") && houseWide(e.entity_id))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id))

  const total = covers.length + locks.length + climates.length + binaries.length + envSensors.length

  if (total === 0) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t("devices.empty")}
          </CardContent>
        </Card>
        <TestAlarmsRow />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Section title={t("devices.controllable")} count={covers.length + locks.length + climates.length}>
        <div className="grid gap-3 lg:grid-cols-2">
          {covers.map((id) => <CoverControl key={id} entityId={id} />)}
          {climates.map((id) => <ClimateControl key={id} entityId={id} />)}
          {locks.map((id) => <LockControl key={id} entityId={id} />)}
        </div>
      </Section>

      <Section title={t("devices.contacts")} count={binaries.length}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {binaries.map((e) => <BinaryChip key={e.entity_id} e={e} />)}
        </div>
      </Section>

      <Section title={t("devices.environment")} count={envSensors.length}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {envSensors.map((e) => <SensorTile key={e.entity_id} e={e} />)}
        </div>
      </Section>

      <TestAlarmsRow />

      <p className="text-center text-[10px] text-muted-foreground">{t("devices.note")}</p>
    </div>
  )
}
