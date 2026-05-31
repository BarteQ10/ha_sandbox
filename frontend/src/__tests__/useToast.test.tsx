import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, act } from "@testing-library/react"
import { ToastProvider, useToast } from "@/hooks/useToast"

// Small harness: a button that fires a toast when clicked.
function Harness({ message, variant }: { message: string; variant?: "default" | "success" | "error" }) {
  const { toast } = useToast()
  return <button onClick={() => toast(message, variant)}>fire</button>
}

describe("useToast", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("renders a toast message when toast() is called", () => {
    render(
      <ToastProvider>
        <Harness message="Saved!" />
      </ToastProvider>,
    )
    expect(screen.queryByText("Saved!")).not.toBeInTheDocument()
    act(() => screen.getByText("fire").click())
    expect(screen.getByText("Saved!")).toBeInTheDocument()
  })

  it("auto-dismisses the toast after the timeout", () => {
    render(
      <ToastProvider>
        <Harness message="Bye" />
      </ToastProvider>,
    )
    act(() => screen.getByText("fire").click())
    expect(screen.getByText("Bye")).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByText("Bye")).not.toBeInTheDocument()
  })

  it("stacks multiple toasts", () => {
    render(
      <ToastProvider>
        <Harness message="One" />
      </ToastProvider>,
    )
    const btn = screen.getByText("fire")
    act(() => btn.click())
    act(() => btn.click())
    expect(screen.getAllByText("One")).toHaveLength(2)
  })

  it("provides a no-op toast when used without a provider", () => {
    // Should not throw — default context value is a no-op.
    expect(() => render(<Harness message="x" />)).not.toThrow()
    act(() => screen.getByText("fire").click())
  })
})
