import { useTranslation } from "react-i18next"
import { Card, CardContent } from "@/components/ui/card"
import { CameraView } from "@/components/CameraView"
import { useEntitiesByDomain } from "@/hooks/useHA"
import { Video } from "lucide-react"

export function Cameras() {
  const { t } = useTranslation()
  const cameraIds = useEntitiesByDomain("camera")

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold sm:text-lg">{t("cameras.title")}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {cameraIds.length}
        </span>
      </div>

      {cameraIds.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <Video className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{t("cameras.empty")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("cameras.emptyHint")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cameraIds.map((id) => (
            <Card key={id} className="overflow-hidden">
              <CardContent className="p-2">
                <CameraView entityId={id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-center text-[10px] text-muted-foreground">{t("cameras.note")}</p>
    </div>
  )
}
