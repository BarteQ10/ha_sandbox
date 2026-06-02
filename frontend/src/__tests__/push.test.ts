import { describe, it, expect, afterEach } from "vitest"
import { pushSupported, pushPermission } from "@/lib/push"

interface WinN { Notification?: { permission: NotificationPermission } }

describe("push", () => {
  const orig = (window as unknown as WinN).Notification
  afterEach(() => {
    if (orig) (window as unknown as WinN).Notification = orig
    else delete (window as unknown as WinN).Notification
  })

  it("reports unsupported when Notification is missing", () => {
    delete (window as unknown as WinN).Notification
    expect(pushSupported()).toBe(false)
    expect(pushPermission()).toBe("denied")
  })

  it("reports supported + permission when Notification exists", () => {
    ;(window as unknown as WinN).Notification = { permission: "granted" }
    expect(pushSupported()).toBe(true)
    expect(pushPermission()).toBe("granted")
  })
})
