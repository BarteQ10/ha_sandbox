import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { HAProvider, useHA } from "@/hooks/useHA"
import { ThemeProvider, useTheme } from "@/hooks/useTheme"
import { ToastProvider } from "@/hooks/useToast"
import { AlarmProvider } from "@/hooks/useAlarms"
import { AlarmBanner } from "@/components/AlarmBanner"
import { usePersistentState } from "@/hooks/usePersistentState"
import { useKiosk } from "@/hooks/useKiosk"
import { Rooms } from "@/components/Rooms"
import { Flow } from "@/components/Flow"
import { Controls } from "@/components/Controls"
import { Energy } from "@/components/Energy"
import { Alerts } from "@/components/Alerts"
import { Weather } from "@/components/Weather"
import { Settings } from "@/components/Settings"
import { Reports } from "@/components/Reports"
import { Presence } from "@/components/Presence"
import { Backtest } from "@/components/Backtest"
import { EventLog } from "@/components/EventLog"
import { Cameras } from "@/components/Cameras"
import { Devices } from "@/components/Devices"
import { Media } from "@/components/Media"
import { FloorPlan } from "@/components/FloorPlan"
import { Timeline } from "@/components/Timeline"
import { Advisor } from "@/components/Advisor"
import { AssistantFab } from "@/components/AssistantFab"
import { DemoBanner } from "@/components/DemoBanner"
import { DashboardSummary } from "@/components/DashboardSummary"
import { CostForecast } from "@/components/CostForecast"
import { Languages, Sun, Moon, WifiOff } from "lucide-react"
import { useSectionVisibility } from "@/hooks/useSectionVisibility"
import {
  SECTIONS,
  firstVisibleSection,
  firstVisibleSub,
  sectionHasContent,
} from "@/lib/sections"

function ConnectionIndicator() {
  const { connected } = useHA()
  const { t } = useTranslation()
  return (
    <Badge
      variant={connected ? "default" : "destructive"}
      className="shrink-0 text-[10px] px-1.5 py-0.5"
      aria-live="polite"
      aria-label={connected ? t("connection.ok") : t("connection.offline")}
    >
      {connected ? t("connection.ok") : t("connection.offline")}
    </Badge>
  )
}

function OfflineBanner() {
  const { connected } = useHA()
  const { t } = useTranslation()
  const [graceOver, setGraceOver] = useState(false)
  useEffect(() => {
    if (connected) return
    const id = setTimeout(() => setGraceOver(true), 2000)
    return () => clearTimeout(id)
  }, [connected])
  if (connected || !graceOver) return null
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-center justify-center gap-2 bg-destructive/90 px-4 py-1.5 text-center text-sm text-destructive-foreground"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="text-xs sm:text-sm">{t("connection.banner")}</span>
    </div>
  )
}

function LangSwitcher() {
  const { i18n } = useTranslation()
  const next = i18n.language === "pl" ? "en" : "pl"
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={() => i18n.changeLanguage(next)}
      aria-label={`Switch language to ${next.toUpperCase()}`}
    >
      <Languages className="h-4 w-4" aria-hidden="true" />
    </Button>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark"
        ? <Sun className="h-4 w-4" aria-hidden="true" />
        : <Moon className="h-4 w-4" aria-hidden="true" />}
    </Button>
  )
}

// Reusable scrollable sub-tab bar (icon always, label on >= sm).
function SubNav({ value, onChange, items }: {
  value: string
  onChange: (v: string) => void
  items: { value: string; icon: React.ElementType; label: string }[]
}) {
  return (
    <div className="overflow-x-auto">
      <Tabs value={value} onValueChange={onChange}>
        <TabsList className="flex w-max min-w-full sm:w-full">
          {items.map(({ value: v, icon: Icon, label }) => (
            <TabsTrigger
              key={v}
              value={v}
              className="flex-1 shrink-0 gap-1"
              title={label}
              aria-label={label}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  )
}

function AppContent() {
  const [tab, setTab] = usePersistentState("ems.tab", "rooms")
  const [roomTab, setRoomTab] = usePersistentState("ems.roomTab", "day")
  const [energyTab, setEnergyTab] = usePersistentState("ems.energyTab", "flow")
  const [monitorTab, setMonitorTab] = usePersistentState("ems.monitorTab", "cameras")
  const [analyticsTab, setAnalyticsTab] = usePersistentState("ems.analyticsTab", "reports")
  const { t } = useTranslation()
  const { hidden, isVisible } = useSectionVisibility()

  // Nav comes from the section registry, so Settings' switches and these tabs
  // cannot disagree about what exists. A section whose every sub-tab is off is
  // dropped too — it would open an empty sub-nav.
  const topSections = SECTIONS.filter(
    (s) => isVisible(s.id) && sectionHasContent(hidden, s.id),
  )
  const subItems = (sectionId: string) =>
    (SECTIONS.find((s) => s.id === sectionId)?.subs ?? [])
      .filter((x) => isVisible(x.key))
      .map((x) => ({ value: x.id, icon: x.icon, label: t(x.labelKey) }))

  // Hiding the section (or sub-tab) you are looking at would otherwise leave a
  // blank page with nothing selected, so move to the first one still there.
  useEffect(() => {
    if (!isVisible(tab) || !sectionHasContent(hidden, tab)) {
      setTab(firstVisibleSection(hidden))
      return
    }
    const subs: [string, string, (v: string) => void][] = [
      ["rooms", roomTab, setRoomTab],
      ["energy", energyTab, setEnergyTab],
      ["monitoring", monitorTab, setMonitorTab],
      ["analytics", analyticsTab, setAnalyticsTab],
    ]
    for (const [id, value, set] of subs) {
      if (id !== tab || isVisible(`${id}.${value}`)) continue
      const next = firstVisibleSub(hidden, id)
      if (next) set(next)
    }
  }, [tab, hidden, isVisible, roomTab, energyTab, monitorTab, analyticsTab,
      setTab, setRoomTab, setEnergyTab, setMonitorTab, setAnalyticsTab])

  // Wall-tablet kiosk mode (?kiosk=1): keep screen awake + return Home when idle.
  useKiosk(() => { setTab("rooms"); setRoomTab("day") })

  // Jump from a home KPI tile straight to the right section + sub-tab.
  const goTo = (target: string) => {
    if (["flow", "energy", "controls", "presence"].includes(target)) {
      setEnergyTab(target); setTab("energy")
    } else if (["cameras", "events", "alerts"].includes(target)) {
      setMonitorTab(target); setTab("monitoring")
    } else if (["reports", "backtest", "weather"].includes(target)) {
      setAnalyticsTab(target); setTab("analytics")
    }
  }

  const topTabClass =
    "flex-1 gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm"

  return (
    <div className="min-h-screen bg-transparent text-foreground">
      {/* Skip link — visible on focus for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:text-primary-foreground focus:shadow"
      >
        Skip to main content
      </a>

      <DemoBanner />

      <header className="sticky top-0 z-50 border-b bg-card text-card-foreground backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-3 sm:px-4">
          {/* Top bar: title + utility buttons */}
          <div className="flex h-10 items-center gap-2">
            <h1 className="min-w-0 truncate text-sm font-bold tracking-wider sm:text-base">
              {t("nav.title")}
            </h1>
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <ThemeToggle />
              <LangSwitcher />
              <ConnectionIndicator />
            </div>
          </div>
          {/* Main nav — themed sections, full width, flush with header bottom */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full rounded-none border-0 bg-transparent p-0 h-9">
              {topSections.map(({ id, labelKey, icon: Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  className={topTabClass}
                  title={t(labelKey)}
                  aria-label={t(labelKey)}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline">{t(labelKey)}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </header>

      <OfflineBanner />
      <AlarmBanner />

      <main id="main-content" className="mx-auto max-w-7xl px-3 py-3 sm:px-4 sm:py-4">
        {tab === "rooms" && (
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-[16rem_1fr] lg:items-start">
            {/* KPI summary — left sidebar on desktop; below the room nav on mobile/tablet */}
            <div className="order-2 min-w-0 space-y-3 sm:space-y-4 lg:order-1 lg:sticky lg:top-[5.5rem]">
              <DashboardSummary variant="side" onNavigate={goTo} />
              <CostForecast />
            </div>
            {/* Rooms column — first on mobile/tablet so the sub-nav stays at the top */}
            <div className="order-1 min-w-0 space-y-3 sm:space-y-4 lg:order-2">
              {/* Room sub-tabs — scrollable on mobile, icon+text on larger screens */}
              <div className="overflow-x-auto">
                <Tabs value={roomTab} onValueChange={setRoomTab}>
                  <TabsList className="flex w-max min-w-full sm:w-full">
                    {subItems("rooms").map(({ value, icon: Icon, label }) => (
                      <TabsTrigger key={value} value={value} className="flex-1 gap-1">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span>{label}</span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              {roomTab === "plan"   && <FloorPlan />}
              {roomTab === "day"    && <Rooms roomIds={["salon", "kuchnia"]} />}
              {roomTab === "night"  && <Rooms roomIds={["sypialnia", "lazienka"]} />}
              {roomTab === "garden" && <Rooms roomIds={["ogrod"]} />}
              {roomTab === "media"  && <Media />}
              {roomTab === "devices" && <Devices />}
            </div>
          </div>
        )}

        {tab === "energy" && (
          <div className="space-y-3 sm:space-y-4">
            <SubNav value={energyTab} onChange={setEnergyTab} items={subItems("energy")} />
            {energyTab === "flow"     && <Flow />}
            {energyTab === "energy"   && <Energy />}
            {energyTab === "advisor"  && <Advisor />}
            {energyTab === "controls" && <Controls />}
            {energyTab === "presence" && <Presence />}
          </div>
        )}

        {tab === "monitoring" && (
          <div className="space-y-3 sm:space-y-4">
            <SubNav value={monitorTab} onChange={setMonitorTab} items={subItems("monitoring")} />
            {monitorTab === "cameras" && <Cameras />}
            {monitorTab === "events"  && <EventLog />}
            {monitorTab === "history" && <Timeline />}
            {monitorTab === "alerts"  && <Alerts />}
          </div>
        )}

        {tab === "analytics" && (
          <div className="space-y-3 sm:space-y-4">
            <SubNav value={analyticsTab} onChange={setAnalyticsTab} items={subItems("analytics")} />
            {analyticsTab === "reports"  && <Reports />}
            {analyticsTab === "backtest" && <Backtest />}
            {analyticsTab === "weather"  && <Weather />}
          </div>
        )}

        {tab === "settings" && (
          <div className="space-y-3 sm:space-y-4">
            <Settings />
          </div>
        )}
      </main>

      {/* Global assistant — available on every tab */}
      <AssistantFab />
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <HAProvider>
        <ToastProvider>
          <AlarmProvider>
            <AppContent />
          </AlarmProvider>
        </ToastProvider>
      </HAProvider>
    </ThemeProvider>
  )
}
