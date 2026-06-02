// Floor-plan layout sync with the simulator's health server (/floorplan, :8088).
// Lets the layout follow the user across browsers/devices instead of living only
// in localStorage.
import type { PlanLayout } from "@/lib/floorplan"

const SIM_URL = import.meta.env.VITE_SIM_URL || "http://localhost:8088"

function isLayout(d: unknown): d is PlanLayout {
  return !!d && Array.isArray((d as PlanLayout).rooms) && Array.isArray((d as PlanLayout).devices)
}

export async function fetchLayout(): Promise<PlanLayout | null> {
  try {
    const res = await fetch(`${SIM_URL}/floorplan`)
    if (!res.ok) return null
    const data = await res.json()
    return isLayout(data) ? data : null
  } catch {
    return null
  }
}

export async function saveLayout(layout: PlanLayout): Promise<boolean> {
  try {
    const res = await fetch(`${SIM_URL}/floorplan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(layout),
    })
    return res.ok
  } catch {
    return false
  }
}
