// Backend origin resolution.
//
// - Dev: explicit VITE_HA_URL / VITE_SIM_URL, or the localhost defaults.
// - Behind the nginx reverse proxy (build with VITE_PROXY=1): everything is
//   same-origin — Home Assistant under /ha, the simulator under /sim. The origin
//   is read at runtime from window.location, so a single proxy build works on
//   localhost, a LAN IP, or a Tailscale hostname without rebuilding.
const PROXY = import.meta.env.VITE_PROXY === "1"
const ORIGIN = typeof window !== "undefined" ? window.location.origin : ""

export const HA_BASE: string =
  import.meta.env.VITE_HA_URL || (PROXY ? `${ORIGIN}/ha` : "http://localhost:8123")

export const SIM_BASE: string =
  import.meta.env.VITE_SIM_URL || (PROXY ? `${ORIGIN}/sim` : "http://localhost:8088")
