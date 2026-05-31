import React, { createContext, useCallback, useContext, useRef, useState } from "react"
import { CheckCircle2, Info, XCircle } from "lucide-react"

// Tiny dependency-free toast system, styled to match the rest of the UI.
// Mirrors the existing context-provider pattern (HAProvider / ThemeProvider).

type ToastVariant = "default" | "success" | "error"

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastCtx {
  toast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastCtx>({ toast: () => {} })

const DISMISS_MS = 3500

const VARIANT_STYLES: Record<ToastVariant, string> = {
  default: "border-border bg-card text-card-foreground",
  success: "border-green-500/30 bg-card text-card-foreground",
  error: "border-destructive/40 bg-card text-card-foreground",
}

const VARIANT_ICON: Record<ToastVariant, React.ElementType> = {
  default: Info,
  success: CheckCircle2,
  error: XCircle,
}

const VARIANT_ICON_COLOR: Record<ToastVariant, string> = {
  default: "text-muted-foreground",
  success: "text-green-500",
  error: "text-destructive",
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const toast = useCallback((message: string, variant: ToastVariant = "default") => {
    const id = nextId.current++
    setToasts((prev) => [...prev, { id, message, variant }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, DISMISS_MS)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
        aria-live="polite"
        aria-atomic="true"
      >
        {toasts.map((t) => {
          const Icon = VARIANT_ICON[t.variant]
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur ${VARIANT_STYLES[t.variant]}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${VARIANT_ICON_COLOR[t.variant]}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
