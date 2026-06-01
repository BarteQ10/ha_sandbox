import { usePersistentState } from "@/hooks/usePersistentState"
import type { StoredScene } from "@/lib/scenes"

// User-defined scenes, persisted as a JSON string in localStorage.
export function useCustomScenes() {
  const [raw, setRaw] = usePersistentState("ems.customScenes", "[]")

  let scenes: StoredScene[] = []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) scenes = parsed
  } catch {
    /* corrupt value → treat as empty */
  }

  const save = (next: StoredScene[]) => setRaw(JSON.stringify(next))
  const add = (scene: StoredScene) => save([...scenes, scene])
  const remove = (id: string) => save(scenes.filter((s) => s.id !== id))

  return { scenes, add, remove }
}
