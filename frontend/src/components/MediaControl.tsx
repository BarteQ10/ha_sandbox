import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { useEntity, useHA } from "@/hooks/useHA"
import { useCommittedSlider } from "@/hooks/useCommittedSlider"
import {
  Music, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, MonitorSpeaker,
} from "lucide-react"

const HA_URL = import.meta.env.VITE_HA_URL || "http://localhost:8123"

// media_player supported_features bit flags
const FEAT = {
  PAUSE: 1, VOLUME_SET: 4, VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16, NEXT_TRACK: 32, PLAY: 16384,
}
const has = (features: number, flag: number) => (features & flag) === flag

function resolvePicture(pic?: string): string | undefined {
  if (!pic) return undefined
  return /^https?:\/\//i.test(pic) ? pic : `${HA_URL}${pic}`
}

function fmtTime(sec: number): string {
  if (!sec || sec < 0) return "0:00"
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

export function MediaControl({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const { callService } = useHA()
  const entity = useEntity(entityId)

  const state = entity?.state ?? "unavailable"
  const a = (entity?.attributes ?? {}) as Record<string, unknown>
  const name = (a.friendly_name as string) ?? entityId
  const title = a.media_title as string | undefined
  const artist = (a.media_artist as string) ?? (a.app_name as string) ?? undefined
  const album = a.media_album_name as string | undefined
  const pic = a.entity_picture as string | undefined
  const volume = (a.volume_level as number) ?? 0          // 0–1
  const muted = Boolean(a.is_volume_muted)
  const position = (a.media_position as number) ?? 0
  const duration = (a.media_duration as number) ?? 0
  const updatedAt = a.media_position_updated_at as string | undefined
  const features = (a.supported_features as number) ?? 0

  const isPlaying = state === "playing"
  const isActive = state === "playing" || state === "paused" || state === "buffering"

  // HA reports media_position only as a snapshot taken at media_position_updated_at;
  // it does not tick. While playing, extrapolate from that timestamp and re-render
  // once a second so the progress bar advances smoothly.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isPlaying) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isPlaying])

  const elapsed = isPlaying && updatedAt ? Math.max(0, (now - Date.parse(updatedAt)) / 1000) : 0
  const livePosition = duration > 0
    ? Math.min(duration, position + elapsed)
    : position + elapsed

  const vol = useCommittedSlider(Math.round(volume * 100), (v) =>
    callService("media_player", "volume_set", { entity_id: entityId, volume_level: v / 100 }),
  )

  const call = (service: string, data: Record<string, unknown> = {}) =>
    callService("media_player", service, { entity_id: entityId, ...data })

  const progress = duration > 0 ? Math.min(100, (livePosition / duration) * 100) : 0

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3 sm:p-4">
        {/* Header: name + state */}
        <div className="mb-3 flex items-center gap-2">
          <MonitorSpeaker className="h-4 w-4 text-muted-foreground" />
          <span className="truncate text-sm font-medium">{name}</span>
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
            isPlaying
              ? "bg-green-500/15 text-green-600 dark:text-green-400"
              : isActive
                ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400"
                : "bg-muted text-muted-foreground"
          }`}>
            {t(`media.state.${isPlaying ? "playing" : isActive ? "paused" : "idle"}`)}
          </span>
        </div>

        {/* Now playing: art + meta */}
        <div className="flex gap-3">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
            {pic
              ? <img src={resolvePicture(pic)} alt={title ?? name} className="h-full w-full object-cover" />
              : <Music className="h-8 w-8 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            {title ? (
              <>
                <p className="truncate text-sm font-semibold">{title}</p>
                {artist && <p className="truncate text-xs text-muted-foreground">{artist}</p>}
                {album && <p className="truncate text-[11px] text-muted-foreground/80">{album}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("media.nothingPlaying")}</p>
            )}

            {/* Progress */}
            {duration > 0 && (
              <div className="mt-2">
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground tabular-nums">
                  <span>{fmtTime(livePosition)}</span>
                  <span>{fmtTime(duration)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Transport controls */}
        <div className="mt-3 flex items-center justify-center gap-2">
          {has(features, FEAT.PREVIOUS_TRACK) && (
            <button
              className="flex h-9 w-9 items-center justify-center rounded-full border hover:bg-accent"
              onClick={() => call("media_previous_track")}
              aria-label={t("media.previous")}
            >
              <SkipBack className="h-4 w-4" />
            </button>
          )}
          <button
            className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90"
            onClick={() => call("media_play_pause")}
            aria-label={isPlaying ? t("media.pause") : t("media.play")}
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          {has(features, FEAT.NEXT_TRACK) && (
            <button
              className="flex h-9 w-9 items-center justify-center rounded-full border hover:bg-accent"
              onClick={() => call("media_next_track")}
              aria-label={t("media.next")}
            >
              <SkipForward className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Volume */}
        {has(features, FEAT.VOLUME_SET) && (
          <div className="mt-3 flex items-center gap-2">
            <button
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => call("volume_mute", { is_volume_muted: !muted })}
              aria-label={muted ? t("media.unmute") : t("media.mute")}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <Slider min={0} max={100} step={1} className="flex-1" {...vol.sliderProps} />
            <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {vol.display}%
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
