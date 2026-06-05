// Web Push handlers, imported into the generated service worker via
// workbox importScripts (see vite.config.ts). Shows a notification when the
// server pushes, and focuses/opens the app when it's clicked.
/* eslint-disable no-undef */
self.addEventListener("push", (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) { /* ignore */ }
  const title = data.title || "EMS"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || undefined,
      data: data.url || "/",
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = event.notification.data || "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) return w.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})
