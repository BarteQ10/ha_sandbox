import { useEffect, useRef } from "react"

// Wall-tablet kiosk mode. Enable by opening the app with ?kiosk=1 (it sticks via
// localStorage; ?kiosk=0 turns it off) — use that URL when adding the PWA to the
// tablet's home screen. While active it:
//   • keeps the screen awake (Wake Lock API — needs HTTPS, which Tailscale gives)
//   • returns to the Home view after a period of no interaction
const IDLE_MS = 180_000
const KEY = "ems.kiosk"

function readEnabled(): boolean {
  if (typeof window === "undefined") return false
  const p = new URLSearchParams(window.location.search)
  if (p.get("kiosk") === "1") { localStorage.setItem(KEY, "1"); return true }
  if (p.get("kiosk") === "0") { localStorage.removeItem(KEY); return false }
  return localStorage.getItem(KEY) === "1"
}

export function useKiosk(onIdle: () => void): { kiosk: boolean } {
  const enabled = readEnabled()
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!enabled) return
    let sentinel: WakeLockSentinel | null = null

    const acquire = async () => {
      try { sentinel = (await navigator.wakeLock?.request("screen")) ?? null } catch { /* unsupported */ }
    }
    void acquire()
    const onVis = () => { if (document.visibilityState === "visible") void acquire() }
    document.addEventListener("visibilitychange", onVis)

    let timer = window.setTimeout(() => onIdleRef.current(), IDLE_MS)
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => onIdleRef.current(), IDLE_MS)
    }
    const events = ["pointerdown", "keydown", "touchstart", "wheel"]
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }))

    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, reset))
      document.removeEventListener("visibilitychange", onVis)
      sentinel?.release?.().catch(() => {})
    }
  }, [enabled])

  return { kiosk: enabled }
}
