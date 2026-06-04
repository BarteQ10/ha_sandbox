import { test, expect } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
    window.localStorage.setItem("ems-theme", "light")
  })
  await page.goto("/")
})

test("Presence sub-tab renders its panel", async ({ page }) => {
  await page.getByRole("tab", { name: "Energy", exact: true }).click()
  await page.getByRole("tab", { name: "Presence", exact: true }).click()
  await expect(page.getByText("Presence & Automation")).toBeVisible()
})

test("Devices tab auto-discovers entities (not empty)", async ({ page }) => {
  // The mock seeds cover.* and climate.* entities, so the Devices view must
  // render them instead of the "No devices" empty state.
  await page.getByRole("tab", { name: "Home", exact: true }).click()
  await page.getByRole("tab", { name: "Devices", exact: true }).click()
  await expect(page.getByText(/No devices/i)).toHaveCount(0)
})

test("Monitoring → History renders without a real backend", async ({ page }) => {
  await page.getByRole("tab", { name: "Monitoring", exact: true }).click()
  const history = page.getByRole("tab", { name: "History", exact: true })
  await history.click()
  await expect(history).toHaveAttribute("data-state", "active")
})
