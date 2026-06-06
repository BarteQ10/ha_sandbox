import { useTranslation } from "react-i18next"
import { FlaskConical, ExternalLink } from "lucide-react"

// Shown only in the public portfolio build (VITE_HA_MOCK=1). Makes it obvious to
// visitors/recruiters that this instance runs on synthetic data and is not wired
// to a real home — and links back to the source.
const IS_DEMO = import.meta.env.VITE_HA_MOCK === "1"
const REPO_URL = "https://github.com/BarteQ10/ha_sandbox"

export function DemoBanner() {
  const { t } = useTranslation()
  if (!IS_DEMO) return null

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 bg-primary px-3 py-1.5 text-center text-xs text-primary-foreground print:hidden">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">{t("demo.title")}</span>
      <span className="opacity-90">{t("demo.subtitle")}</span>
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:opacity-80"
      >
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        {t("demo.source")}
      </a>
    </div>
  )
}
