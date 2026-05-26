import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  callService as wsCallService,
  type Connection,
  type HassEntities,
} from "home-assistant-js-websocket"

const HA_URL = import.meta.env.VITE_HA_URL || "http://localhost:8123"
const HA_TOKEN = import.meta.env.VITE_HA_TOKEN

let conn: Connection | null = null
let entities: HassEntities = {}
let onEntitiesCB: ((e: HassEntities) => void) | null = null
let onConnectedCB: (() => void) | null = null
let onDisconnectedCB: (() => void) | null = null

export async function connectHA() {
  try {
    const auth = createLongLivedTokenAuth(HA_URL, HA_TOKEN)
    conn = await createConnection({ auth })
    subscribeEntities(conn, (e) => {
      entities = e
      onEntitiesCB?.(e)
    })
    conn.addEventListener("disconnected", () => onDisconnectedCB?.())
    conn.addEventListener("reconnect", () => {
      subscribeEntities(conn!, (e) => {
        entities = e
        onEntitiesCB?.(e)
      })
      onConnectedCB?.()
    })
    onConnectedCB?.()
    return conn
  } catch (e) {
    console.error("HA WS connection failed:", e)
    onDisconnectedCB?.()
    throw e
  }
}

export function getConnection() {
  return conn
}

export function getInitialEntities(): HassEntities {
  return entities
}

export function setCallbacks(
  onEntities: (e: HassEntities) => void,
  onConnected: () => void,
  onDisconnected: () => void
) {
  onEntitiesCB = onEntities
  onConnectedCB = onConnected
  onDisconnectedCB = onDisconnected
  if (conn) onConnectedCB?.()
}

export async function haCallService(domain: string, service: string, data: Record<string, unknown>) {
  if (!conn) throw new Error("Not connected")
  await wsCallService(conn, domain, service, data)
}

export async function fetchHistory(
  entityId: string,
  startTime: string,
  endTime: string
): Promise<Array<{ state: string; last_changed: string }>> {
  try {
    const res = await fetch(
      `${HA_URL}/api/history/period/${startTime}?filter_entity_id=${entityId}&end_time=${endTime}&minimal_response`,
      {
        headers: {
          Authorization: `Bearer ${HA_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    )
    if (!res.ok) return []
    const raw = (await res.json()) as Array<Array<Record<string, string>>>
    if (raw.length > 0 && Array.isArray(raw[0])) {
      return raw[0]
        .filter((r) => r.state !== undefined && !isNaN(Number(r.state)))
        .map((r) => ({ state: r.state, last_changed: r.last_changed }))
    }
    return []
  } catch {
    return []
  }
}
