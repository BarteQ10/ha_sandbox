// Web Push subscription flow. Asks the simulator for the VAPID public key,
// subscribes the browser's push manager, and registers the subscription so the
// backend (push.py) can deliver notifications even when the app is closed.
import { SIM_BASE } from "./base"

export type PushResult =
  | { ok: true; count?: number }
  | { ok: false; reason: "unsupported" | "disabled" | "denied" | "error" }

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(b64)
  const buf = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function getPushKey(): Promise<{ publicKey: string; enabled: boolean } | null> {
  try {
    const res = await fetch(`${SIM_BASE}/push/key`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function subscribePush(): Promise<PushResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { ok: false, reason: "unsupported" }
  }
  const key = await getPushKey()
  if (!key?.enabled || !key.publicKey) return { ok: false, reason: "disabled" }

  const perm = await Notification.requestPermission()
  if (perm !== "granted") return { ok: false, reason: "denied" }

  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key.publicKey),
    })
    const res = await fetch(`${SIM_BASE}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: true, count: data.count }
  } catch {
    return { ok: false, reason: "error" }
  }
}

export async function sendTestPush(): Promise<number> {
  try {
    const res = await fetch(`${SIM_BASE}/push/test`, { method: "POST" })
    const data = await res.json()
    return data.sent ?? 0
  } catch {
    return 0
  }
}
