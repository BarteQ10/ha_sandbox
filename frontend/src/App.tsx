import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { HAProvider, useHA } from "@/hooks/useHA"
import { ThemeProvider, useTheme } from "@/hooks/useTheme"
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
import { Media } from "@/components/Media"
import { DashboardSummary } from "@/components/DashboardSummary"
import {
  Home, Languages, Sun, Moon, Bolt, ToggleLeft, BarChart3, FileText,
  Sofa, Bed, TreePine, WifiOff, Bell, CloudSun, SlidersHorizontal, Users, FlaskConical, ScrollText, Video, Music,
} from "lucide-react"

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

function AppContent() {
  const [tab, setTab] = useState("rooms")
  const [roomTab, setRoomTab] = useState("day")
  const [sysTab, setSysTab] = useState("flow")
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-transparent text-foreground">
      {/* Skip link — visible on focus for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[100] focus:rounded focus:bg-primary focus:px-3 focus:py-1.5 focus:text-sm focus:text-primary-foreground focus:shadow"
      >
        Skip to main content
      </a>

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
          {/* Main nav — full width, flush with header bottom */}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full rounded-none border-0 bg-transparent p-0 h-9">
              <TabsTrigger
                value="rooms"
                className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm"
              >
                <Home className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t("nav.rooms")}
              </TabsTrigger>
              <TabsTrigger
                value="system"
                className="flex-1 gap-1.5 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs sm:text-sm"
              >
                <Bolt className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t("nav.system")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <OfflineBanner />

      <main id="main-content" className="mx-auto max-w-7xl px-3 py-3 sm:px-4 sm:py-4">
        {tab === "rooms" && (
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-[16rem_1fr] lg:items-start">
            {/* KPI summary — left sidebar on desktop, full-width strip on mobile */}
            <div className="lg:sticky lg:top-[5.5rem]">
              <DashboardSummary variant="side" />
            </div>
            {/* Rooms column */}
            <div className="space-y-3 sm:space-y-4">
              {/* Room sub-tabs — scrollable on mobile, icon+text on larger screens */}
              <div className="overflow-x-auto">
                <Tabs value={roomTab} onValueChange={setRoomTab}>
                  <TabsList className="flex w-max min-w-full sm:w-full">
                    <TabsTrigger value="day" className="flex-1 gap-1">
                      <Sofa className="h-4 w-4 shrink-0" />
                      <span>{t("rooms.day")}</span>
                    </TabsTrigger>
                    <TabsTrigger value="night" className="flex-1 gap-1">
                      <Bed className="h-4 w-4 shrink-0" />
                      <span>{t("rooms.night")}</span>
                    </TabsTrigger>
                    <TabsTrigger value="garden" className="flex-1 gap-1">
                      <TreePine className="h-4 w-4 shrink-0" />
                      <span>{t("rooms.gardenLabel")}</span>
                    </TabsTrigger>
                    <TabsTrigger value="media" className="flex-1 gap-1">
                      <Music className="h-4 w-4 shrink-0" />
                      <span>{t("nav.media")}</span>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              {roomTab === "day"    && <Rooms roomIds={["salon", "kuchnia"]} />}
              {roomTab === "night"  && <Rooms roomIds={["sypialnia", "lazienka"]} />}
              {roomTab === "garden" && <Rooms roomIds={["ogrod"]} />}
              {roomTab === "media"  && <Media />}
            </div>
          </div>
        )}

        {tab === "system" && (
          <div className="space-y-3 sm:space-y-4">
            {/* System sub-tabs — scrollable; text hidden on mobile to avoid overflow */}
            <div className="overflow-x-auto">
              <Tabs value={sysTab} onValueChange={setSysTab}>
                <TabsList className="flex w-max min-w-full sm:w-full">
                  <TabsTrigger value="flow" className="flex-1 shrink-0 gap-1">
                    <Bolt className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.flow")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="controls" className="flex-1 shrink-0 gap-1">
                    <ToggleLeft className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.controls")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="energy" className="flex-1 shrink-0 gap-1">
                    <BarChart3 className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.energy")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="alerts" className="flex-1 shrink-0 gap-1">
                    <Bell className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.alerts")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="events" className="flex-1 shrink-0 gap-1">
                    <ScrollText className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.events")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="cameras" className="flex-1 shrink-0 gap-1">
                    <Video className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.cameras")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="weather" className="flex-1 shrink-0 gap-1">
                    <CloudSun className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.weather")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="reports" className="flex-1 shrink-0 gap-1">
                    <FileText className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.reports")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="backtest" className="flex-1 shrink-0 gap-1">
                    <FlaskConical className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.backtest")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="presence" className="flex-1 shrink-0 gap-1">
                    <Users className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.presence")}</span>
                  </TabsTrigger>
                  <TabsTrigger value="settings" className="flex-1 shrink-0 gap-1">
                    <SlidersHorizontal className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">{t("nav.settings")}</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {sysTab === "flow"     && <Flow />}
            {sysTab === "controls" && <Controls />}
            {sysTab === "energy"   && <Energy />}
            {sysTab === "alerts"   && <Alerts />}
            {sysTab === "events"   && <EventLog />}
            {sysTab === "cameras"  && <Cameras />}
            {sysTab === "weather"  && <Weather />}
            {sysTab === "reports"  && <Reports />}
            {sysTab === "backtest" && <Backtest />}
            {sysTab === "presence" && <Presence />}
            {sysTab === "settings" && <Settings />}
          </div>
        )}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <HAProvider>
        <AppContent />
      </HAProvider>
    </ThemeProvider>
  )
}
