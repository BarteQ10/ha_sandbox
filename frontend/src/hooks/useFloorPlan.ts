import { usePersistentState } from "@/hooks/usePersistentState"
import {
  DEFAULT_LAYOUT, addDevice, removeDevice, moveDevice, moveRoom, resizeRoom,
  type PlanLayout,
} from "@/lib/floorplan"

// localStorage-backed floor-plan layout with reducer-style mutators.
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
  const save = (l: PlanLayout) => setRaw(JSON.stringify(l))

  return {
    layout,
    addDevice: (entity: string) => save(addDevice(layout, entity)),
    removeDevice: (id: string) => save(removeDevice(layout, id)),
    moveDevice: (id: string, x: number, y: number) => save(moveDevice(layout, id, x, y)),
    moveRoom: (id: string, x: number, y: number) => save(moveRoom(layout, id, x, y)),
    resizeRoom: (id: string, w: number, h: number) => save(resizeRoom(layout, id, w, h)),
    reset: () => setRaw(""),
  }
}
