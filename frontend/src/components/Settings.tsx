import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useEntityNum, useEntityState, useHA } from "@/hooks/useHA"
import {
  Settings2, Battery, Sun, Zap, MapPin, Clock,
  Bell, Webhook, Send, CheckCircle2, XCircle,
} from "lucide-react"

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

  // localStorage backup: persists across refreshes even when HA entity state
  // is slow to update or the dev instance is freshly started.
  const lsKey = `ems_setting_${entityId}`
  const [committed, setCommitted] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(lsKey)
      return v !== null ? Number(v) : null
    } catch { return null }
  })
  const [dragging, setDragging] = useState<number | null>(null)

  // Priority: active drag > localStorage committed value > HA entity value
  const display = dragging ?? committed ?? entityValue

  function save(v: number) {
    const clamped = Math.min(max, Math.max(min, Math.round(v / step) * step))
    setDragging(null)
    setCommitted(clamped)
    try { localStorage.setItem(lsKey, String(clamped)) } catch { /* private mode */ }
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
        onValueChange={([v]) => setDragging(v)}
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

// ─── Notification channel status badge ───────────────────────────────────────

function ChannelStatus({ icon, label, configured }: {
  icon: React.ReactNode; label: string; configured: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between py-1.5 text-sm border-b last:border-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </div>
      <span className={`flex items-center gap-1 text-xs font-medium ${
        configured ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
      }`}>
        {configured
          ? <><CheckCircle2 className="h-3.5 w-3.5" /> {t("settings.notifConfigured")}</>
          : <><XCircle className="h-3.5 w-3.5" /> {t("settings.notifNotConfigured")}</>}
      </span>
    </div>
  )
}

// ─── Notifications card ────────────────────────────────────────────────────────

function NotificationsCard() {
  const { t } = useTranslation()
  const { callService } = useHA()

  const enabled  = useEntityState("input_boolean.ems_notifications_enabled") === "on"
  // Template sensors render Python bool as "True"/"False"
  const webhook  = useEntityState("sensor.ems_powiadomienia_webhook_skonfig") === "True"
  const telegram = useEntityState("sensor.ems_powiadomienia_telegram_skonfig") === "True"
  const anyConfigured = webhook || telegram

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">{t("settings.notifTitle")}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4">
        {/* Master switch */}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("settings.notifEnable")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.notifEnableDesc")}</p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={() =>
              callService("input_boolean", enabled ? "turn_off" : "turn_on", {
                entity_id: "input_boolean.ems_notifications_enabled",
              })
            }
          />
        </div>

        {/* Channel status */}
        <div>
          <ChannelStatus
            icon={<Webhook className="h-3.5 w-3.5" />}
            label={t("settings.notifWebhook")}
            configured={webhook}
          />
          <ChannelStatus
            icon={<Send className="h-3.5 w-3.5" />}
            label={t("settings.notifTelegram")}
            configured={telegram}
          />
        </div>

        {/* Test button */}
        <Button
          variant="outline"
          className="w-full"
          disabled={!anyConfigured}
          onClick={() =>
            callService("input_button", "press", {
              entity_id: "input_button.ems_notify_test",
            })
          }
        >
          <Send className="mr-2 h-4 w-4" />
          {t("settings.notifTest")}
        </Button>

        <p className="text-[11px] text-muted-foreground">
          {anyConfigured ? t("settings.notifHint") : t("settings.notifHintEnv")}
        </p>
      </CardContent>
    </Card>
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
        </CardContent>
      </Card>

      {/* Notifications */}
      <NotificationsCard />

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
