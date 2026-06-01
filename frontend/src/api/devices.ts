// Device test API — talks to the simulator's health server (/test-alarm, port 8088)
// to manually latch a safety sensor ON so the alarm flow can be demonstrated.

const SIM_URL = import.meta.env.VITE_SIM_URL || "http://localhost:8088"

export type AlarmKind = "smoke" | "co" | "leak"

export async function triggerAlarm(type: AlarmKind): Promise<boolean> {
  try {
    const res = await fetch(`${SIM_URL}/test-alarm?type=${type}`)
    const data = await res.json()
    return Boolean(data.triggered)
  } catch {
    return false
  }
}
