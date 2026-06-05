import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useEntity, useEntityState } from "@/hooks/useHA"
import { Camera, CameraOff, Image as ImageIcon, Video, Maximize2 } from "lucide-react"
import { HA_BASE as HA_URL } from "@/api/base"

interface CameraViewProps {
  entityId: string
  /** start in MJPEG stream mode instead of polled snapshot */
  stream?: boolean
  /** snapshot refresh interval (ms); ignored in stream mode */
  refreshMs?: number
  /** CSS aspect-ratio (e.g. "16/9") */
  aspect?: string
  /** optional motion binary_sensor — shows a MOTION badge when "on" */
  motionEntity?: string
}

function Placeholder({ icon: Icon, text, aspect }: {
  icon: React.ElementType; text: string; aspect: string
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 text-muted-foreground"
      style={{ aspectRatio: aspect }}
    >
      <Icon className="h-7 w-7" />
      <span className="px-3 text-center text-xs">{text}</span>
    </div>
  )
}

export function CameraView({
  entityId,
  stream = false,
  refreshMs = 2000,
  aspect = "16/9",
  motionEntity,
}: CameraViewProps) {
  const { t } = useTranslation()
  const entity = useEntity(entityId)
  const pic = entity?.attributes?.entity_picture as string | undefined
  const motion = useEntityState(motionEntity ?? "", "off") === "on"

  const containerRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<"snapshot" | "stream">(stream ? "stream" : "snapshot")
  const [tick, setTick] = useState(0)
  const [errored, setErrored] = useState(false)
  const isStream = mode === "stream"

  // Snapshot refresh — skip in stream mode (MJPEG streams continuously)
  useEffect(() => {
    if (isStream || !pic) return
    const id = setInterval(() => setTick((x) => x + 1), refreshMs)
    return () => clearInterval(id)
  }, [isStream, pic, refreshMs])

  // Reset error when the source picture or mode changes
  useEffect(() => { setErrored(false) }, [pic, mode])

  function toggleFullscreen() {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen?.()
    else el.requestFullscreen?.()
  }

  if (!entity || !pic) {
    return <Placeholder icon={CameraOff} text={t("camera.unavailable")} aspect={aspect} />
  }
  if (errored) {
    return <Placeholder icon={CameraOff} text={t("camera.offline")} aspect={aspect} />
  }

  // entity_picture is like "/api/camera_proxy/camera.x?token=..."
  const path = isStream ? pic.replace("/camera_proxy/", "/camera_proxy_stream/") : pic
  const sep = path.includes("?") ? "&" : "?"
  const src = `${HA_URL}${path}${isStream ? "" : `${sep}_=${tick}`}`
  const label = (entity.attributes?.friendly_name as string) ?? entityId

  return (
    <div
      ref={containerRef}
      className="group relative overflow-hidden rounded-lg border bg-black"
      style={{ aspectRatio: aspect }}
    >
      <img
        src={src}
        alt={label}
        className="h-full w-full object-contain"
        onError={() => setErrored(true)}
      />

      {/* Name label */}
      <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
        <Camera className="h-3 w-3" />
        {label}
      </div>

      {/* LIVE badge in stream mode */}
      {isStream && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-red-600/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          {t("camera.live")}
        </span>
      )}

      {/* MOTION badge */}
      {motion && (
        <span className="absolute bottom-2 left-2 animate-pulse rounded bg-yellow-500/85 px-1.5 py-0.5 text-[10px] font-bold text-black">
          {t("camera.motion")}
        </span>
      )}

      {/* Controls — appear on hover (always visible on touch via opacity) */}
      <div className="absolute bottom-2 right-2 flex gap-1 opacity-70 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => setMode((m) => (m === "stream" ? "snapshot" : "stream"))}
          className="flex h-7 w-7 items-center justify-center rounded bg-black/60 text-white hover:bg-black/80"
          aria-label={isStream ? t("camera.toSnapshot") : t("camera.toStream")}
          title={isStream ? t("camera.toSnapshot") : t("camera.toStream")}
        >
          {isStream ? <ImageIcon className="h-4 w-4" /> : <Video className="h-4 w-4" />}
        </button>
        <button
          onClick={toggleFullscreen}
          className="flex h-7 w-7 items-center justify-center rounded bg-black/60 text-white hover:bg-black/80"
          aria-label={t("camera.fullscreen")}
          title={t("camera.fullscreen")}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
