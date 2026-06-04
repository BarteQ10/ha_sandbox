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

test("renders telemetry from the mock store", async ({ page }) => {
  await page.goto("/")
  // The Battery (SoC) KPI tile must show the mock fixture value (73%).
  // Scope to the tile that has both "Battery" and "73" so it can't collide
  // with the "Battery health" tile or any other number on the page.
  const socTile = page
    .getByRole("button")
    .filter({ hasText: "Battery" })
    .filter({ hasText: "73" })
  await expect(socTile).toBeVisible()
})
