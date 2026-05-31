import { describe, it, expect } from "vitest"
import { cn } from "@/lib/utils"

describe("cn()", () => {
  it("returns empty string for no args", () => {
    expect(cn()).toBe("")
  })

  it("joins class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar")
  })

  it("resolves Tailwind conflicts — last wins", () => {
    // twMerge: later utility of the same property wins
    expect(cn("p-2", "p-4")).toBe("p-4")
    expect(cn("text-sm", "text-lg")).toBe("text-lg")
  })

  it("filters falsy values", () => {
    expect(cn("foo", false, undefined, null, "bar")).toBe("foo bar")
  })

  it("handles conditional object syntax", () => {
    expect(cn({ active: true, hidden: false })).toBe("active")
  })
})
