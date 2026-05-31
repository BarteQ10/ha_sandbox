import { useEffect, useState } from "react"

// useState that mirrors its value to localStorage, so a chosen tab survives a
// page reload. Falls back to `initial` when storage is empty or unavailable
// (e.g. private mode, SSR, or a quota error).
export function usePersistentState(key: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* ignore quota / unavailable storage */
    }
  }, [key, value])

  return [value, setValue]
}
