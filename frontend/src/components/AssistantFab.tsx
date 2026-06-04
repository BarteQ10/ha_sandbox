import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Assistant } from "@/components/Assistant"
import { Bot, X } from "lucide-react"

// Global, always-visible assistant launcher. Floats bottom-right on every tab so
// natural-language + voice control is one tap away from anywhere in the app.
export function AssistantFab() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2 print:hidden">
      {open && (
        <div className="w-[min(92vw,380px)] max-h-[75vh] overflow-y-auto rounded-2xl border bg-card text-card-foreground shadow-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-end border-b bg-card/95 px-2 py-1.5 backdrop-blur">
            <button
              onClick={() => setOpen(false)}
              aria-label={t("assistant.close")}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-3">
            <Assistant />
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("assistant.title")}
        title={t("assistant.title")}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {open ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>
    </div>
  )
}
