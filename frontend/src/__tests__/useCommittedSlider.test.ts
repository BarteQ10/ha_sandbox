import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useCommittedSlider } from "@/hooks/useCommittedSlider"

describe("useCommittedSlider", () => {
  it("displays entityValue when no local drag is active", () => {
    const { result } = renderHook(() => useCommittedSlider(50, vi.fn()))
    expect(result.current.display).toBe(50)
  })

  it("tracks local value during drag (onValueChange)", () => {
    const { result } = renderHook(() => useCommittedSlider(50, vi.fn()))
    act(() => {
      result.current.sliderProps.onValueChange([75])
    })
    expect(result.current.display).toBe(75)
  })

  it("resets to entityValue after commit and calls onCommit", () => {
    const onCommit = vi.fn()
    const { result } = renderHook(() => useCommittedSlider(50, onCommit))

    act(() => result.current.sliderProps.onValueChange([80]))
    expect(result.current.display).toBe(80)

    act(() => result.current.sliderProps.onValueCommit([80]))
    expect(result.current.display).toBe(50) // local cleared → back to entity
    expect(onCommit).toHaveBeenCalledWith(80)
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it("always wraps display value in an array for Radix Slider", () => {
    const { result } = renderHook(() => useCommittedSlider(30, vi.fn()))
    expect(result.current.sliderProps.value).toEqual([30])
  })

  it("updates display when entityValue prop changes and no drag is active", () => {
    let entityValue = 20
    const { result, rerender } = renderHook(() => useCommittedSlider(entityValue, vi.fn()))
    expect(result.current.display).toBe(20)

    entityValue = 60
    rerender()
    expect(result.current.display).toBe(60)
  })

  it("keeps local drag value even when entityValue prop changes mid-drag", () => {
    let entityValue = 20
    const { result, rerender } = renderHook(() => useCommittedSlider(entityValue, vi.fn()))

    act(() => result.current.sliderProps.onValueChange([45]))
    expect(result.current.display).toBe(45)

    entityValue = 60
    rerender()
    // local drag value wins while dragging
    expect(result.current.display).toBe(45)
  })
})
