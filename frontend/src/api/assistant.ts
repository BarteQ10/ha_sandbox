// Layer-2 assistant: when the local rule parser can't match a command, ask the
// simulator's /assistant endpoint, which proxies a locally-hosted LLM
// (LM Studio / Ollama). Same origin convention as advisor/backtest (:8088).
const SIM_URL = import.meta.env.VITE_SIM_URL || "http://localhost:8088"

export interface RemoteIntent {
  intent: string
  value: number | null
  enabled: boolean   // false when the simulator has no LLM configured
}

/** Classify free text via the backend LLM. Returns null on transport failure. */
export async function classifyRemote(text: string): Promise<RemoteIntent | null> {
  try {
    const res = await fetch(`${SIM_URL}/assistant`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data?.intent !== "string") return null
    return {
      intent: data.intent,
      value: typeof data.value === "number" ? data.value : null,
      enabled: Boolean(data.enabled),
    }
  } catch {
    return null
  }
}
