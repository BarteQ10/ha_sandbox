import { useEffect } from "react"
import { usePersistentState } from "@/hooks/usePersistentState"
import { fetchLayout, saveLayout } from "@/api/floorplan"
import {
  DEFAULT_LAYOUT, addDevice, removeDevice, moveDevice, moveRoom, resizeRoom,
  addRoom, removeRoom, renameRoom, updateRoom, type PlanLayout, type PlanRoom,
} from "@/lib/floorplan"

// Floor-plan layout: synced to the simulator (cross-browser), with localStorage
// as an offline cache. On mount we pull the server copy (source of truth);
// every change writes through to both localStorage and the server.
export function useFloorPlan() {
  const [raw, setRaw] = usePersistentState("ems.floorplan", "")

  let layout: PlanLayout = DEFAULT_LAYOUT
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.rooms) && Array.isArray(parsed.devices)) layout = parsed
    } catch {
      /* corrupt → default */
    }
  }

  // Hydrate from the server once on mount (overrides the local cache).
  useEffect(() => {
    let cancelled = false
    fetchLayout().then((l) => { if (l && !cancelled) setRaw(JSON.stringify(l)) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = (l: PlanLayout) => {
    setRaw(JSON.stringify(l))   // local cache (instant)
    saveLayout(l)               // server (fire-and-forget; offline-safe)
  }

  return {
    layout,
    addDevice: (entity: string) => save(addDevice(layout, entity)),
    removeDevice: (id: string) => save(removeDevice(layout, id)),
    moveDevice: (id: string, x: number, y: number) => save(moveDevice(layout, id, x, y)),
    moveRoom: (id: string, x: number, y: number) => save(moveRoom(layout, id, x, y)),
    resizeRoom: (id: string, w: number, h: number) => save(resizeRoom(layout, id, w, h)),
    addRoom: (label: string) => save(addRoom(layout, label)),
    removeRoom: (id: string) => save(removeRoom(layout, id)),
    renameRoom: (id: string, label: string) => save(renameRoom(layout, id, label)),
    updateRoom: (id: string, patch: Partial<PlanRoom>) => save(updateRoom(layout, id, patch)),
    setLayout: (l: PlanLayout) => save(l),
    reset: () => setRaw(""),
  }
}
