import { useState } from "react"
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
import { Home, Languages, Sun, Moon, Bolt, ToggleLeft, BarChart3, Sofa, Bed, TreePine } from "lucide-react"

function ConnectionIndicator() {
  const { connected } = useHA()
  const { t } = useTranslation()
  return (
    <Badge variant={connected ? "default" : "destructive"} className="ml-auto">
      {connected ? t("connection.ok") : t("connection.offline")}
    </Badge>
  )
}

function LangSwitcher() {
  const { i18n } = useTranslation()
  const next = i18n.language === "pl" ? "en" : "pl"
  return (
    <Button variant="ghost" size="sm" onClick={() => i18n.changeLanguage(next)} className="gap-1">
      <Languages className="h-4 w-4" />
      {next.toUpperCase()}
    </Button>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <Button variant="ghost" size="sm" onClick={toggle} className="gap-1">
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
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
      <header className="sticky top-0 z-50 border-b bg-card text-card-foreground backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2">
          <h1 className="text-lg font-bold tracking-wider">{t("nav.title")}</h1>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="rooms" className="gap-1">
                <Home className="h-4 w-4" /> {t("nav.rooms")}
              </TabsTrigger>
              <TabsTrigger value="system" className="gap-1">
                <Bolt className="h-4 w-4" /> {t("nav.system")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <ThemeToggle />
          <LangSwitcher />
          <ConnectionIndicator />
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4">
        {tab === "rooms" && (
          <div className="space-y-4">
            <Tabs value={roomTab} onValueChange={setRoomTab}>
              <TabsList>
                <TabsTrigger value="day" className="gap-1">
                  <Sofa className="h-4 w-4" /> {t("rooms.day")}
                </TabsTrigger>
                <TabsTrigger value="night" className="gap-1">
                  <Bed className="h-4 w-4" /> {t("rooms.night")}
                </TabsTrigger>
                <TabsTrigger value="garden" className="gap-1">
                  <TreePine className="h-4 w-4" /> {t("rooms.gardenLabel")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {roomTab === "day" && <Rooms roomIds={["salon", "kuchnia"]} />}
            {roomTab === "night" && <Rooms roomIds={["sypialnia", "lazienka"]} />}
            {roomTab === "garden" && <Rooms roomIds={["ogrod"]} />}
          </div>
        )}
        {tab === "system" && (
          <div className="space-y-4">
            <Tabs value={sysTab} onValueChange={setSysTab}>
              <TabsList>
                <TabsTrigger value="flow" className="gap-1">
                  <Bolt className="h-4 w-4" /> {t("nav.flow")}
                </TabsTrigger>
                <TabsTrigger value="controls" className="gap-1">
                  <ToggleLeft className="h-4 w-4" /> {t("nav.controls")}
                </TabsTrigger>
                <TabsTrigger value="energy" className="gap-1">
                  <BarChart3 className="h-4 w-4" /> {t("nav.energy")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {sysTab === "flow" && <Flow />}
            {sysTab === "controls" && <Controls />}
            {sysTab === "energy" && <Energy />}
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
