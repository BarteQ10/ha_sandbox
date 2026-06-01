import type { HassEntity } from "home-assistant-js-websocket"

// Pure derivation of active alarms from the HA entity map, so it can be unit
// tested without React or Web Audio.

export type Severity = "critical" | "warning"

export interface Alarm {
  key: string        // stable identity for edge detection
  labelKey: string   // i18n key for display
  severity: Severity
}

// binary_sensor device_class → critical alarm label
const CRITICAL_BS: Record<string, string> = {
  smoke: "alarms.smoke",
  carbon_monoxide: "alarms.co",
  gas: "alarms.gas",
  moisture: "alarms.leak",
}

export const LOW_SOC_THRESHOLD = 10

export function deriveAlarms(entities: Record<string, HassEntity>): Alarm[] {
  const out: Alarm[] = []

  for (const e of Object.values(entities)) {
    if (e.entity_id.startsWith("binary_sensor.") && e.state === "on") {
      const dc = (e.attributes.device_class as string) ?? ""
      const labelKey = CRITICAL_BS[dc]
      if (labelKey) out.push({ key: e.entity_id, labelKey, severity: "critical" })
    }
  }

  if (entities["sensor.ems_status_sieci"]?.state === "1") {
    out.push({ key: "blackout", labelKey: "alarms.blackout", severity: "critical" })
  }

  const soc = Number(entities["sensor.sztuczny_stan_baterii_soc"]?.state)
  if (!Number.isNaN(soc) && soc <= LOW_SOC_THRESHOLD) {
    out.push({ key: "low_soc", labelKey: "alarms.lowSoc", severity: "warning" })
  }

  return out
}
