import { test, expect } from "@playwright/test"

// Phone-sized viewport: top nav collapses to icon-only (labels hidden < sm),
// but aria-labels keep every tab reachable by accessible name.
test.use({ viewport: { width: 375, height: 700 } })

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
  })
  await page.goto("/")
})

test("navigation works on a mobile viewport", async ({ page }) => {
  const energy = page.getByRole("tab", { name: "Energy", exact: true })
  await energy.click()
  await expect(energy).toHaveAttribute("data-state", "active")
  // Energy sub-tabs are still reachable (scrollable bar)
  await expect(page.getByRole("tab", { name: "Flow", exact: true })).toBeVisible()
})

test("connection badge is visible on mobile", async ({ page }) => {
  await expect(page.getByText("HA OK")).toBeVisible()
})

test("kiosk mode loads and stays usable", async ({ page }) => {
  await page.goto("/?kiosk=1")
  await expect(page.getByRole("heading", { name: "Smart Home" })).toBeVisible()
  await page.getByRole("tab", { name: "Energy", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Energy", exact: true })).toHaveAttribute("data-state", "active")
})

test("Home view has no horizontal overflow on a phone", async ({ page }) => {
  // Regression: the rooms-tab grid used to overflow (~566px on a 390px screen)
  // because an overflow-x-auto sub-tab bar expanded its grid column.
  await page.waitForTimeout(800)
  const overflow = await page.evaluate(
    () => document.body.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})
