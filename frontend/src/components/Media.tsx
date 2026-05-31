import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { MediaControl } from "@/components/MediaControl"
import { useEntitiesByDomain, useEntityState } from "@/hooks/useHA"
import { Music, Play, Pause, StopCircle } from "lucide-react"

// Read-only fallback showing the simulator's media state when no real
// media_player.* entity is configured in HA.
function SimulatedMedia() {
  const { t } = useTranslation()
  const state = useEntityState("sensor.ems_tryb_mediow", "idle")
  const icon = state === "playing"
    ? <Play className="h-4 w-4 text-green-400" />
    : state === "paused"
      ? <Pause className="h-4 w-4 text-yellow-400" />
      : <StopCircle className="h-4 w-4 text-muted-foreground" />

  return (
    <Card className="border-dashed">
      <CardContent className="flex items-center gap-3 p-4">
        <Music className="h-5 w-5 text-muted-foreground" />
        {icon}
        <div>
          <p className="text-sm font-medium">{t("media.simulated")}</p>
          <p className="text-xs text-muted-foreground">
            {t(`media.state.${state === "playing" ? "playing" : state === "paused" ? "paused" : "idle"}`)}
            {" · "}sensor.ems_tryb_mediow
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export function Media() {
  const { t } = useTranslation()
  const playerIds = useEntitiesByDomain("media_player")

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold sm:text-lg">{t("media.title")}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {playerIds.length}
        </span>
      </div>

      {playerIds.length === 0 ? (
        <>
          <Card>
            <CardContent className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              <Music className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{t("media.empty")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("media.emptyHint")}</p>
              </div>
            </CardContent>
          </Card>
          <SimulatedMedia />
        </>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {playerIds.map((id) => (
            <MediaControl key={id} entityId={id} />
          ))}
        </div>
      )}

      <p className="text-center text-[10px] text-muted-foreground">{t("media.note")}</p>
    </div>
  )
}
