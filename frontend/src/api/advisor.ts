// "Best time to run" advisor — talks to the simulator's /advisor endpoint (:8088).
import { SIM_BASE, simHeaders } from "./base"
const SIM_URL = SIM_BASE

export interface AdvHour { hour: number; price_gr: number; pv_w: number }
export interface AdvRec {
  name: string
  power_w: number
  duration_h: number
  best_hour: number
  cost_gr: number
  cost_now_gr: number
  saving_gr: number
}
export interface Advisor { hours: AdvHour[]; recommendations: AdvRec[] }

export async function fetchAdvisor(): Promise<Advisor | null> {
  try {
    const res = await fetch(`${SIM_URL}/advisor`, { headers: simHeaders() })
    if (!res.ok) return null
    const data = await res.json()
    if (Array.isArray(data?.hours) && Array.isArray(data?.recommendations)) return data
    return null
  } catch {
    return null
  }
}
