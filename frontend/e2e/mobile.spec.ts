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
