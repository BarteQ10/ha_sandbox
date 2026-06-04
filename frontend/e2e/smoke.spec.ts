import { test, expect } from "@playwright/test"

// Force English so label assertions are deterministic regardless of the test
// machine's browser locale (i18next detects localStorage first — see i18n.ts).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
  })
})

test("loads the dashboard and connects to the mock HA", async ({ page }) => {
  await page.goto("/")

  // Header title
  await expect(page.getByRole("heading", { name: "Smart Home" })).toBeVisible()

  // The mock backend reports a live connection (badge text from i18n)
  await expect(page.getByText("HA OK")).toBeVisible()

  // The offline banner must NOT appear (it shows after a 2s grace if offline)
  await page.waitForTimeout(2500)
  await expect(page.getByRole("alert")).toHaveCount(0)
})

test("renders a real telemetry value from the mock store", async ({ page }) => {
  await page.goto("/")
  // Battery SoC fixture is 73% — assert it surfaces somewhere on the home view.
  await expect(page.getByText(/73/).first()).toBeVisible()
})
