import { describe, it, expect, beforeEach, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { usePersistentState } from "@/hooks/usePersistentState"

describe("usePersistentState", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("uses the initial value when storage is empty", () => {
    const { result } = renderHook(() => usePersistentState("ems.test", "flow"))
    expect(result.current[0]).toBe("flow")
  })

  it("hydrates from a previously stored value", () => {
    localStorage.setItem("ems.test", "energy")
    const { result } = renderHook(() => usePersistentState("ems.test", "flow"))
    expect(result.current[0]).toBe("energy")
  })

  it("persists updates back to localStorage", () => {
    const { result } = renderHook(() => usePersistentState("ems.test", "flow"))
    act(() => result.current[1]("reports"))
    expect(result.current[0]).toBe("reports")
    expect(localStorage.getItem("ems.test")).toBe("reports")
  })

  it("falls back to initial when localStorage.getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    const { result } = renderHook(() => usePersistentState("ems.test", "day"))
    expect(result.current[0]).toBe("day")
  })

  it("does not throw when setItem fails (quota / private mode)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota")
    })
    const { result } = renderHook(() => usePersistentState("ems.test", "flow"))
    expect(() => act(() => result.current[1]("alerts"))).not.toThrow()
    expect(result.current[0]).toBe("alerts")
  })
})
