import { test, expect } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
    window.localStorage.setItem("ems-theme", "light")
  })
  await page.goto("/")
})

test("Media tab shows the auto-discovered player and now-playing", async ({ page }) => {
  await page.getByRole("tab", { name: "Home", exact: true }).click()
  await page.getByRole("tab", { name: "Media", exact: true }).click()

  await expect(page.getByText("Salon Speaker")).toBeVisible()   // friendly_name
  await expect(page.getByText("Mock Track")).toBeVisible()       // media_title
})

// 1×1 transparent PNG — stands in for the HA camera proxy snapshot so the
// <img> loads instead of erroring into the "offline" placeholder.
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

test("Cameras tab shows the auto-discovered camera tile", async ({ page }) => {
  await page.route("**/api/camera_proxy/**", (route) =>
    route.fulfill({ contentType: "image/png", body: Buffer.from(PNG_1x1, "base64") }))

  await page.getByRole("tab", { name: "Monitoring", exact: true }).click()
  await page.getByRole("tab", { name: "Cameras", exact: true }).click()

  await expect(page.getByText("Garden Cam")).toBeVisible()
  await expect(page.getByText(/No cameras/i)).toHaveCount(0)
})
