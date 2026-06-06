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
    <>
      {/* Scrim: dims + blocks the content underneath (tap to close). Without it the
          translucent card token lets the page bleed through, which looks broken on phones. */}
      {open && (
        <button
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm print:hidden sm:bg-black/30"
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-[60] flex flex-col items-stretch gap-2 p-3 print:hidden sm:inset-x-auto sm:bottom-4 sm:right-4 sm:items-end sm:p-0">
        {open && (
          <div className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-2xl border bg-background text-foreground shadow-2xl sm:max-h-[75vh] sm:w-[min(92vw,380px)]">
            <div className="flex items-center justify-end border-b bg-background px-2 py-1.5">
              <button
                onClick={() => setOpen(false)}
                aria-label={t("assistant.close")}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-3">
              <Assistant />
            </div>
          </div>
        )}

        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={t("assistant.title")}
          title={t("assistant.title")}
          className="flex h-14 w-14 items-center justify-center self-end rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {open ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
        </button>
      </div>
    </>
  )
}
