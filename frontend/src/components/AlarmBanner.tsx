import { useTranslation } from "react-i18next"
import { useAlarms } from "@/hooks/useAlarms"
import { AlertTriangle, VolumeX, X } from "lucide-react"

// Full-width red banner shown while any critical alarm is active.
export function AlarmBanner() {
  const { t } = useTranslation()
  const { activeCritical, dismissed, dismiss, soundEnabled, setSoundEnabled } = useAlarms()

  if (dismissed || activeCritical.length === 0) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-center gap-2 bg-destructive px-4 py-2 text-sm text-destructive-foreground"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 animate-pulse" aria-hidden="true" />
      <span className="min-w-0 flex-1 font-medium">
        {activeCritical.map((a) => t(a.labelKey)).join(" · ")}
      </span>
      {soundEnabled && (
        <button
          onClick={() => setSoundEnabled(false)}
          className="shrink-0 rounded p-1 hover:bg-white/15"
          aria-label={t("alarms.mute")}
          title={t("alarms.mute")}
        >
          <VolumeX className="h-4 w-4" />
        </button>
      )}
      <button
        onClick={dismiss}
        className="shrink-0 rounded p-1 hover:bg-white/15"
        aria-label={t("alarms.dismiss")}
        title={t("alarms.dismiss")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
