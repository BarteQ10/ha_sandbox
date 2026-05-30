import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  callService as wsCallService,
  type Connection,
  type HassEntities,
  type HassEntity,
} from "home-assistant-js-websocket"

const HA_URL = import.meta.env.VITE_HA_URL || "http://localhost:8123"
const HA_TOKEN = import.meta.env.VITE_HA_TOKEN

// ---------------------------------------------------------------------------
// External store — single source of truth for entity state + connection status.
// Consumers use useSyncExternalStore (via useHA/useEntity hooks) so React only
// re-renders components that actually read the entity that changed.
// ---------------------------------------------------------------------------

interface HAStore {
  entities: HassEntities
  connected: boolean
}

let _store: HAStore = { entities: {}, connected: false }
const _listeners = new Set<() => void>()

function _notify() {
  for (const l of _listeners) l()
}

function _setEntities(e: HassEntities) {
  _store = { ..._store, entities: e }
  _notify()
}

function _setConnected(v: boolean) {
  if (_store.connected === v) return
  _store = { ..._store, connected: v }
  _notify()
}

export function subscribe(listener: () => void): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

export function getSnapshot(): HAStore {
  return _store
}

// Per-entity snapshot — stable reference when the entity didn't change.
// Keyed snapshots so each hook gets a distinct cache slot.
const _entityCache = new Map<string, HassEntity | undefined>()

export function getEntitySnapshot(entityId: string): HassEntity | undefined {
  const current = _store.entities[entityId]
  if (_entityCache.get(entityId) === current) return _entityCache.get(entityId)
  _entityCache.set(entityId, current)
  return current
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

let _conn: Connection | null = null
let _unsub: (() => void) | null = null

function _subscribeEntities(c: Connection) {
  _unsub?.()
  _unsub = subscribeEntities(c, (e) => _setEntities(e))
}

export async function connectHA(): Promise<Connection> {
  if (!HA_TOKEN) {
    throw new Error(
      "VITE_HA_TOKEN is not set — copy .env.example to .env and add a long-lived token from " +
        `${HA_URL}/profile`
    )
  }
  const auth = createLongLivedTokenAuth(HA_URL, HA_TOKEN)
  _conn = await createConnection({ auth })
  _subscribeEntities(_conn)
  _conn.addEventListener("disconnected", () => _setConnected(false))
  _conn.addEventListener("reconnect", () => {
    _subscribeEntities(_conn!)
    _setConnected(true)
  })
  _setConnected(true)
  return _conn
}

export async function haCallService(
  domain: string,
  service: string,
  data: Record<string, unknown>
): Promise<void> {
  if (!_conn) throw new Error("Not connected")
  await wsCallService(_conn, domain, service, data)
}

// ---------------------------------------------------------------------------
// History REST
// ---------------------------------------------------------------------------

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
