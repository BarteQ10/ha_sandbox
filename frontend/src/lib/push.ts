// Browser system notifications (Notifications API). These show even when the
// dashboard tab is backgrounded. True push to a fully-closed browser would need
// a push service + backend (out of scope); this covers the common case.

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window
}

export function pushPermission(): NotificationPermission {
  return pushSupported() ? Notification.permission : "denied"
}

// Must be called from a user gesture. Returns true if granted.
export async function requestPush(): Promise<boolean> {
  if (!pushSupported()) return false
  if (Notification.permission === "granted") return true
  try {
    return (await Notification.requestPermission()) === "granted"
  } catch {
    return false
  }
}

// Prefer the service-worker registration (more reliable when backgrounded),
// fall back to the Notification constructor.
export async function showNotification(title: string, body: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return
  const opts: NotificationOptions = { body, tag: "ems-alarm", icon: "/pwa-192x192.png" }
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.()
    if (reg) { await reg.showNotification(title, opts); return }
  } catch {
    /* fall through */
  }
  try {
    new Notification(title, opts)
  } catch {
    /* unsupported context */
  }
}
