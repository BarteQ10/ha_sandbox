import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useEntity, useEntityState } from "@/hooks/useHA"
import { Camera, CameraOff } from "lucide-react"

const HA_URL = import.meta.env.VITE_HA_URL || "http://localhost:8123"

interface CameraViewProps {
  entityId: string
  /** MJPEG live stream instead of a polled snapshot */
  stream?: boolean
  /** snapshot refresh interval (ms); ignored when stream=true */
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
      <span className="text-xs">{text}</span>
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

  const [tick, setTick] = useState(0)
  const [errored, setErrored] = useState(false)

  // Snapshot refresh — skip for MJPEG (it streams continuously)
  useEffect(() => {
    if (stream || !pic) return
    const id = setInterval(() => setTick((x) => x + 1), refreshMs)
    return () => clearInterval(id)
  }, [stream, pic, refreshMs])

  // Reset the error flag whenever the source picture changes
  useEffect(() => { setErrored(false) }, [pic])

  if (!entity || !pic) {
    return <Placeholder icon={CameraOff} text={t("camera.unavailable")} aspect={aspect} />
  }
  if (errored) {
    return <Placeholder icon={CameraOff} text={t("camera.offline")} aspect={aspect} />
  }

  // entity_picture is like "/api/camera_proxy/camera.x?token=..."
  const path = stream ? pic.replace("/camera_proxy/", "/camera_proxy_stream/") : pic
  const sep = path.includes("?") ? "&" : "?"
  const src = `${HA_URL}${path}${stream ? "" : `${sep}_=${tick}`}`
  const label = (entity.attributes?.friendly_name as string) ?? entityId

  return (
    <div className="relative overflow-hidden rounded-lg border bg-black" style={{ aspectRatio: aspect }}>
      <img
        src={src}
        alt={label}
        className="h-full w-full object-cover"
        onError={() => setErrored(true)}
      />
      <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
        <Camera className="h-3 w-3" />
        {label}
      </div>
      {stream && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded bg-red-600/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          {t("camera.live")}
        </span>
      )}
      {motion && (
        <span className="absolute bottom-2 left-2 animate-pulse rounded bg-yellow-500/85 px-1.5 py-0.5 text-[10px] font-bold text-black">
          {t("camera.motion")}
        </span>
      )}
    </div>
  )
}
