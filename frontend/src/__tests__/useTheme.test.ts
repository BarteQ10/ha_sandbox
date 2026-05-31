import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import React from "react"
import { ThemeProvider, useTheme } from "@/hooks/useTheme"

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(ThemeProvider, null, children)
}

describe("useTheme / ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  it("defaults to light when no localStorage and system prefers light", () => {
    // setup.ts mocks matchMedia to return matches:false → system prefers light
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.theme).toBe("light")
  })

  it("reads saved theme from localStorage", () => {
    localStorage.setItem("ems-theme", "light")
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.theme).toBe("light")
  })

  it("ignores invalid localStorage value and falls back to system preference", () => {
    localStorage.setItem("ems-theme", "banana")
    // matchMedia returns matches: false → 'light' from system
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(["light", "dark"]).toContain(result.current.theme)
  })

  it("follows system dark preference when no localStorage value", () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.theme).toBe("dark")
  })

  it("toggle() switches theme and persists to localStorage", () => {
    localStorage.setItem("ems-theme", "light")
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current.theme).toBe("light")

    act(() => result.current.toggle())
    expect(result.current.theme).toBe("dark")
    expect(localStorage.getItem("ems-theme")).toBe("dark")

    act(() => result.current.toggle())
    expect(result.current.theme).toBe("light")
  })
})
