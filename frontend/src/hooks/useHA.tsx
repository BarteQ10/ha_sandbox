import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import type { HassEntities } from "home-assistant-js-websocket"
import { connectHA, setCallbacks, getInitialEntities, haCallService } from "../api/haClient"

interface HACtx {
  entities: HassEntities
  connected: boolean
  callService: (domain: string, service: string, data: Record<string, unknown>) => Promise<void>
}

const HADefaultContext: HACtx = {
  entities: {},
  connected: false,
  callService: async () => {},
}

const Ctx = createContext<HACtx>(HADefaultContext)

export function HAProvider({ children }: { children: React.ReactNode }) {
  const [entities, setEntities] = useState<HassEntities>(getInitialEntities)
  const [connected, setConnected] = useState(false)
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    setCallbacks(
      (e) => setEntities({ ...e }),
      () => setConnected(true),
      () => setConnected(false)
    )

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

  return <Ctx.Provider value={{ entities, connected, callService }}>{children}</Ctx.Provider>
}

export function useHA() {
  return useContext(Ctx)
}

export function useEntity(entityId: string) {
  const { entities } = useHA()
  return entities[entityId]
}

export function useEntityState(entityId: string, fallback = "0"): string {
  const ent = useEntity(entityId)
  return ent?.state ?? fallback
}

export function useEntityNum(entityId: string, fallback = 0): number {
  const val = useEntityState(entityId, String(fallback))
  return Number(val)
}
