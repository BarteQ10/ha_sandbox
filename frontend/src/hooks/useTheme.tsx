import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

type Theme = "light" | "dark"

interface ThemeCtx {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeCtx>({ theme: "dark", toggle: () => {} })

function getInitial(): Theme {
  if (typeof window === "undefined") return "dark"
  const saved = localStorage.getItem("ems-theme") as Theme | null
  if (saved === "light" || saved === "dark") return saved
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitial)

  useEffect(() => {
    const root = document.documentElement
    if (theme === "dark") {
      root.classList.add("dark")
    } else {
      root.classList.remove("dark")
    }
    localStorage.setItem("ems-theme", theme)
  }, [theme])

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"))

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
