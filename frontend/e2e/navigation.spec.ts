import { test, expect } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
  })
  await page.goto("/")
})

const TOP_SECTIONS = ["Energy", "Monitoring", "Analytics", "Settings", "Home"]

test("navigates every top-level section", async ({ page }) => {
  for (const name of TOP_SECTIONS) {
    const tab = page.getByRole("tab", { name, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute("data-state", "active")
  }
})

test("Energy section exposes its sub-tabs", async ({ page }) => {
  await page.getByRole("tab", { name: "Energy", exact: true }).click()
  for (const sub of ["Flow", "Charts", "Advisor", "Controls", "Presence"]) {
    await expect(page.getByRole("tab", { name: sub, exact: true })).toBeVisible()
  }
})

test("Monitoring section exposes its sub-tabs", async ({ page }) => {
  await page.getByRole("tab", { name: "Monitoring", exact: true }).click()
  for (const sub of ["Cameras", "Events", "History", "Alerts"]) {
    await expect(page.getByRole("tab", { name: sub, exact: true })).toBeVisible()
  }
})

test("remembers the selected tab across reloads", async ({ page }) => {
  await page.getByRole("tab", { name: "Settings", exact: true }).click()
  await page.reload()
  await expect(page.getByRole("tab", { name: "Settings", exact: true }))
    .toHaveAttribute("data-state", "active")
})
