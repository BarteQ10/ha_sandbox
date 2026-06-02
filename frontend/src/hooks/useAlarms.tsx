import React, { createContext, useContext, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useHA } from "@/hooks/useHA"
import { usePersistentState } from "@/hooks/usePersistentState"
import { useToast } from "@/hooks/useToast"
import { deriveAlarms, type Alarm } from "@/lib/alarms"
import { playAlarm, unlockAudio } from "@/lib/sound"
import { pushPermission, requestPush, showNotification } from "@/lib/push"

// How often an active, unacknowledged critical alarm re-sounds.
const REPEAT_MS = 8000

interface AlarmCtx {
  soundEnabled: boolean
  setSoundEnabled: (b: boolean) => void
  criticalOnly: boolean
  setCriticalOnly: (b: boolean) => void
  activeCritical: Alarm[]
  dismissed: boolean
  dismiss: () => void
  test: () => void
  pushEnabled: boolean
  setPushEnabled: (b: boolean) => void
  pushPermission: NotificationPermission
}

const AlarmContext = createContext<AlarmCtx>({
  soundEnabled: true,
  setSoundEnabled: () => {},
  criticalOnly: false,
  setCriticalOnly: () => {},
  activeCritical: [],
  dismissed: false,
  dismiss: () => {},
  test: () => {},
  pushEnabled: false,
  setPushEnabled: () => {},
  pushPermission: "default",
})

export function AlarmProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  const { entities } = useHA()
  const { toast } = useToast()

  const [soundStr, setSoundStr] = usePersistentState("ems.alarmSound", "1")
  const [critStr, setCritStr]   = usePersistentState("ems.alarmCriticalOnly", "0")
  const [pushStr, setPushStr]   = usePersistentState("ems.alarmPush", "0")
  const soundEnabled = soundStr === "1"
  const criticalOnly = critStr === "1"
  const pushEnabled = pushStr === "1"

  const alarms = deriveAlarms(entities)
  const activeCritical = alarms.filter((a) => a.severity === "critical")
  const sig = alarms.map((a) => `${a.severity}:${a.key}`).sort().join("|")

  const prevRef = useRef<Set<string>>(new Set())
  const [dismissed, setDismissed] = useState(false)

  // Edge-triggered: act only on alarms that just became active.
  useEffect(() => {
    const current = new Set(alarms.map((a) => a.key))
    const fresh = alarms.filter((a) => !prevRef.current.has(a.key))
    const newCrit = fresh.filter((a) => a.severity === "critical")
    const newWarn = fresh.filter((a) => a.severity === "warning")

    if (newCrit.length) {
      if (soundEnabled) playAlarm("critical")
      setDismissed(false)
      newCrit.forEach((a) => toast(t(a.labelKey), "error"))
      if (pushEnabled) showNotification(t("alarms.pushTitle"), newCrit.map((a) => t(a.labelKey)).join(" · "))
    } else if (newWarn.length) {
      if (soundEnabled && !criticalOnly) playAlarm("warning")
      newWarn.forEach((a) => toast(t(a.labelKey)))
      if (pushEnabled && !criticalOnly) showNotification(t("alarms.pushTitle"), newWarn.map((a) => t(a.labelKey)).join(" · "))
    }
    prevRef.current = current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  // While a critical alarm stays active and unacknowledged, re-sound it every
  // REPEAT_MS — unless the user muted sound or dismissed the banner.
  const hasCritical = activeCritical.length > 0
  useEffect(() => {
    if (!hasCritical || dismissed || !soundEnabled) return
    const id = setInterval(() => playAlarm("critical"), REPEAT_MS)
    return () => clearInterval(id)
  }, [hasCritical, dismissed, soundEnabled])

  // Unlock the AudioContext on the first user gesture (browser autoplay policy).
  useEffect(() => {
    const h = () => { unlockAudio(); window.removeEventListener("pointerdown", h) }
    window.addEventListener("pointerdown", h)
    return () => window.removeEventListener("pointerdown", h)
  }, [])

  const value: AlarmCtx = {
    soundEnabled,
    setSoundEnabled: (b) => setSoundStr(b ? "1" : "0"),
    criticalOnly,
    setCriticalOnly: (b) => setCritStr(b ? "1" : "0"),
    activeCritical,
    dismissed,
    dismiss: () => setDismissed(true),
    test: () => { unlockAudio(); playAlarm("critical"); if (pushEnabled) showNotification(t("alarms.pushTitle"), t("alarms.testToast")) },
    pushEnabled,
    setPushEnabled: async (b: boolean) => {
      if (!b) { setPushStr("0"); return }
      const ok = await requestPush()
      setPushStr(ok ? "1" : "0")
    },
    pushPermission: pushPermission(),
  }

  return <AlarmContext.Provider value={value}>{children}</AlarmContext.Provider>
}

export function useAlarms() {
  return useContext(AlarmContext)
}
