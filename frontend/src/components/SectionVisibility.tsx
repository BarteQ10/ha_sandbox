import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { useSectionVisibility } from "@/hooks/useSectionVisibility"
import { LOCKED_SECTION, PANELS, SECTIONS } from "@/lib/sections"
import { Eye, Lock } from "lucide-react"

/**
 * Choose which sections of the dashboard are shown.
 *
 * Most of this dashboard is the simulator: a battery, an inverter, a heat pump
 * and a car that exist only in ems_simulator. A house with a real WLED strip
 * and a contact sensor wants those panels out of the nav rather than scrolled
 * past, which is what the "my hardware" preset does in one click.
 *
 * The preference lives in this browser (localStorage) and changes nothing on
 * the backend — the simulator keeps simulating, and every section is one switch
 * away from coming back. To stop the simulator publishing its virtual devices
 * to Home Assistant at all, that is EMS_SIM_DEVICES in .env.
 */
export function SectionVisibility() {
  const { t } = useTranslation()
  const { hidden, isVisible, toggle, applyPreset } = useSectionVisibility()
  const hiddenCount = hidden.filter((k) => k !== LOCKED_SECTION).length

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">{t("settings.sectionsTitle")}</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("settings.sectionsDesc")}</p>
      </CardHeader>

      <CardContent className="space-y-3 px-4 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => applyPreset("all")}>
            {t("settings.sectionsPresetAll")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => applyPreset("real")}>
            {t("settings.sectionsPresetReal")}
          </Button>
          {hiddenCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {t("settings.sectionsHiddenCount", { count: hiddenCount })}
            </span>
          )}
        </div>

        <div className="divide-y rounded-md border">
          {SECTIONS.map((section) => {
            const locked = section.id === LOCKED_SECTION
            const sectionOn = isVisible(section.id)
            const SectionIcon = section.icon
            return (
              <div key={section.id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <SectionIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{t(section.labelKey)}</span>
                    {locked && (
                      <span
                        className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
                        title={t("settings.sectionsLocked")}
                      >
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        {t("settings.sectionsLocked")}
                      </span>
                    )}
                  </div>
                  <Switch
                    checked={sectionOn}
                    disabled={locked}
                    onCheckedChange={() => toggle(section.id)}
                    aria-label={t(section.labelKey)}
                  />
                </div>

                {section.subs.length > 0 && (
                  // Dimmed rather than removed when the whole section is off:
                  // the sub-choices are still worth seeing, and hiding them
                  // would make turning the section back on feel like a reset.
                  <div
                    className={`mt-2 space-y-1.5 border-l pl-4 ${
                      sectionOn ? "" : "pointer-events-none opacity-40"
                    }`}
                  >
                    {section.subs.map((item) => {
                      const SubIcon = item.icon
                      return (
                        <div key={item.key} className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <SubIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-xs">{t(item.labelKey)}</span>
                          </div>
                          <Switch
                            checked={isVisible(item.key)}
                            disabled={!sectionOn}
                            onCheckedChange={() => toggle(item.key)}
                            aria-label={`${t(section.labelKey)} — ${t(item.labelKey)}`}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="divide-y rounded-md border">
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("settings.sectionsPanels")}
            </p>
          </div>
          {PANELS.map((panel) => {
            const PanelIcon = panel.icon
            return (
              <div key={panel.key} className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-2">
                  <PanelIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-medium">{t(panel.labelKey)}</span>
                </div>
                <Switch
                  checked={isVisible(panel.key)}
                  onCheckedChange={() => toggle(panel.key)}
                  aria-label={t(panel.labelKey)}
                />
              </div>
            )
          })}
        </div>

        <p className="text-[11px] text-muted-foreground">{t("settings.sectionsNote")}</p>
      </CardContent>
    </Card>
  )
}
