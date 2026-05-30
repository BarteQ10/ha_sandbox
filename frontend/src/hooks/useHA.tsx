import React, { createContext, useContext, useCallback, useEffect, useRef, useSyncExternalStore } from "react"
import type { HassEntity } from "home-assistant-js-websocket"
import { connectHA, haCallService, subscribe, getSnapshot, getEntitySnapshot } from "../api/haClient"

interface HACtx {
  callService: (domain: string, service: string, data: Record<string, unknown>) => Promise<void>
}

const HAContext = createContext<HACtx>({ callService: async () => {} })

export function HAProvider({ children }: { children: React.ReactNode }) {
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true
    connectHA().catch(() => {})
  }, [])

  const callService = useCallback(
    async (domain: string, service: string, data: Record<string, unknown>) => {
      try {
        await haCallService(domain, service, data)
      } catch (e) {
        console.error("HA service call failed:", e)
      }
    },
    []
  )

  return <HAContext.Provider value={{ callService }}>{children}</HAContext.Provider>
}

export function useHA() {
  const { callService } = useContext(HAContext)
  const { connected } = useSyncExternalStore(subscribe, getSnapshot)
  return { connected, callService }
}

export function useEntity(entityId: string): HassEntity | undefined {
  return useSyncExternalStore(
    subscribe,
    () => getEntitySnapshot(entityId)
  )
}

export function useEntityState(entityId: string, fallback = "0"): string {
  const ent = useEntity(entityId)
  return ent?.state ?? fallback
}

export function useEntityNum(entityId: string, fallback = 0): number {
  const val = useEntityState(entityId, String(fallback))
  return Number(val)
}
