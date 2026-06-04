import { test, expect } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
    window.localStorage.setItem("ems-theme", "light")
    // usePersistentState stores raw strings (not JSON). Defaults already land on
    // Home → "Common" (salon + kuchnia), so no tab seeding is needed.
  })
  await page.goto("/")
})

test("Living Room card shows its temperature from the mock", async ({ page }) => {
  await expect(page.getByText("Living Room").first()).toBeVisible()
  // input_number.wirtualna_temp_salon fixture = 21.5 °C
  await expect(page.getByText(/21\.5/).first()).toBeVisible()
})

test("toggling a room light switch flips its state", async ({ page }) => {
  // First "Main" light belongs to the Living Room (rendered before Kitchen).
  const lightRow = page.getByText("Main", { exact: true }).first().locator("..")
  const sw = lightRow.getByRole("switch")

  await expect(sw).toHaveAttribute("aria-checked", "false")
  await sw.click()
  await expect(sw).toHaveAttribute("aria-checked", "true")
})

test("the floor plan sub-tab renders", async ({ page }) => {
  const planTab = page.getByRole("tab", { name: "Plan", exact: true })
  await planTab.click()
  await expect(planTab).toHaveAttribute("data-state", "active")
})
