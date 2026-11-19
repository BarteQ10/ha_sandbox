import {
  createConnection,
  createLongLivedTokenAuth,
  subscribeEntities,
  callService as wsCallService,
  type Connection,
  type HassEntities,
  type HassEntity,
} from "home-assistant-js-websocket"
import { HA_BASE } from "./base"

const HA_URL = HA_BASE
// SECURITY: VITE_HA_TOKEN is bundled into client-side JS at build time.
// Keep this app behind your home network / VPN — never expose it publicly.
// Use a dedicated HA user with minimal permissions; see frontend/.env.example.
const HA_TOKEN = import.meta.env.VITE_HA_TOKEN
// Offline mock backend for E2E / no-HA dev — seeds the store from fixtures
// instead of opening a WebSocket. Enabled via VITE_HA_MOCK=1 (see .env.e2e).
const HA_MOCK = import.meta.env.VITE_HA_MOCK === "1"

// ---------------------------------------------------------------------------
// External store — single source of truth for entity state + connection status.
// Consumers use useSyncExternalStore (via useHA/useEntity hooks) so React only
// re-renders components that actually read the entity that changed.
// ---------------------------------------------------------------------------

interface HAStore {
  entities: HassEntities
  connected: boolean
  /**
   * entity_id -> Home Assistant area name.
   *
   * Empty until the registries load, and empty for good against a mock or a
   * non-admin token. Everything that reads it treats "no area" as "show it
   * where it was always shown", so the dashboard degrades to its previous
   * behaviour rather than losing devices.
   */
  areaOf: Record<string, string>
}

let _store: HAStore = { entities: {}, connected: false, areaOf: {} }
const _listeners = new Set<() => void>()

function _notify() {
  for (const l of _listeners) l()
}

function _setEntities(e: HassEntities) {
  _store = { ..._store, entities: e }
  _notify()
}

function _setAreas(areaOf: Record<string, string>) {
  _store = { ..._store, areaOf }
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

// Per-entity snapshot with state-key comparison.
// home-assistant-js-websocket may mutate entity objects in place rather than
// creating new references on state change. Comparing object references alone
// (===) would make useSyncExternalStore miss those updates and not re-render.
// Comparing state+last_updated strings guarantees detection regardless of
// whether the library uses mutation or replacement semantics.
interface _CacheEntry { key: string; entity: HassEntity | undefined }
const _entityCache = new Map<string, _CacheEntry>()

function _entityKey(e: HassEntity | undefined): string {
  return e ? `${e.state}|${e.last_updated}` : ""
}

export function getEntitySnapshot(entityId: string): HassEntity | undefined {
  const entity = _store.entities[entityId]
  const key = _entityKey(entity)
  const cached = _entityCache.get(entityId)
  if (cached?.key === key) return cached.entity
  // State or timestamp changed — create a new object reference so that
  // useSyncExternalStore's Object.is() comparison triggers a re-render.
  const fresh = entity ? { ...entity } : undefined
  _entityCache.set(entityId, { key, entity: fresh })
  return fresh
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

let _conn: Connection | null = null
let _unsub: (() => void) | null = null

interface AreaEntry { area_id: string; name: string }
interface DeviceEntry { id: string; area_id: string | null }
interface EntityEntry { entity_id: string; area_id: string | null; device_id: string | null }

/**
 * Map every entity to the name of the area it sits in.
 *
 * The registries are a separate websocket call from the state subscription and
 * change rarely, so this runs once per connection. They need an admin token;
 * without one the call throws and the map stays empty, which every reader
 * treats as "this entity has no room" rather than as an error.
 */
async function _loadAreas(c: Connection) {
  try {
    const [areas, devices, ents] = await Promise.all([
      c.sendMessagePromise<AreaEntry[]>({ type: "config/area_registry/list" }),
      c.sendMessagePromise<DeviceEntry[]>({ type: "config/device_registry/list" }),
      c.sendMessagePromise<EntityEntry[]>({ type: "config/entity_registry/list" }),
    ])
    const nameOfArea = new Map(areas.map((a) => [a.area_id, a.name]))
    const areaOfDevice = new Map(devices.map((d) => [d.id, d.area_id]))

    const map: Record<string, string> = {}
    for (const e of ents) {
      // An entity inherits its device's area unless it overrides it, which is
      // how Home Assistant itself resolves this.
      const areaId = e.area_id ?? (e.device_id ? areaOfDevice.get(e.device_id) ?? null : null)
      const name = areaId ? nameOfArea.get(areaId) : undefined
      if (name) map[e.entity_id] = name
    }
    _setAreas(map)
  } catch {
    /* no registry access — rooms keep showing exactly what they showed before */
  }
}

function _subscribeEntities(c: Connection) {
  _unsub?.()
  _unsub = subscribeEntities(c, (e) => _setEntities(e))
}

export async function connectHA(): Promise<Connection> {
  if (HA_MOCK) {
    const { MOCK_ENTITIES } = await import("./haMock")
    _setEntities(MOCK_ENTITIES)
    _setConnected(true)
    return {} as Connection
  }
  if (!HA_TOKEN) {
    throw new Error(
      "VITE_HA_TOKEN is not set — copy .env.example to .env and add a long-lived token from " +
        `${HA_URL}/profile`
    )
  }
  const auth = createLongLivedTokenAuth(HA_URL, HA_TOKEN)
  _conn = await createConnection({ auth })
  _subscribeEntities(_conn)
  void _loadAreas(_conn)
  _conn.addEventListener("disconnected", () => _setConnected(false))
  // "reconnect" exists at runtime but is missing from the type definitions in
  // home-assistant-js-websocket — cast to any to silence the TS error.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(_conn as any).addEventListener("reconnect", () => {
    _subscribeEntities(_conn!)
    void _loadAreas(_conn!)
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
  if (HA_MOCK) {
    const { applyMockService } = await import("./haMock")
    applyMockService(domain, service, data, _store.entities, _setEntities)
    return
  }
  if (!_conn) throw new Error("Not connected")
  await wsCallService(_conn, domain, service, data)
}

// ---------------------------------------------------------------------------
// History REST
// ---------------------------------------------------------------------------

export async function fetchHistoryMulti(
  entityIds: string[],
  startTime: string,
  endTime: string
): Promise<Map<string, Array<{ state: string; last_changed: string }>>> {
  const out = new Map<string, Array<{ state: string; last_changed: string }>>()
  if (!entityIds.length) return out
  try {
    const ids = entityIds.join(",")
    const res = await fetch(
      `${HA_URL}/api/history/period/${startTime}?filter_entity_id=${ids}&end_time=${endTime}&minimal_response`,
      { headers: { Authorization: `Bearer ${HA_TOKEN}`, "Content-Type": "application/json" } }
    )
    if (!res.ok) return out
    const raw = (await res.json()) as Array<Array<Record<string, string>>>
    for (const series of raw) {
      if (!series.length) continue
      const id = series[0]?.entity_id ?? ""
      if (!id) continue
      out.set(id, series.filter((r) => r.state !== undefined && !isNaN(Number(r.state)))
        .map((r) => ({ state: r.state, last_changed: r.last_changed })))
    }
  } catch { /* empty */ }
  return out
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
