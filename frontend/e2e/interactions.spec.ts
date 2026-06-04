import { test, expect, type Page } from "@playwright/test"

// Force English + a known theme so assertions are deterministic regardless of
// the host browser locale / colour-scheme.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
    window.localStorage.setItem("ems-theme", "light")
  })
  await page.goto("/")
})

async function openControls(page: Page) {
  await page.getByRole("tab", { name: "Energy", exact: true }).click()
  await page.getByRole("tab", { name: "Controls", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Controls" })).toBeVisible()
}

test("toggling the boiler switch updates its state (mock service round-trip)", async ({ page }) => {
  await openControls(page)

  // The Label and Switch are siblings inside the card; scope via the label's parent.
  const boilerCard = page.getByText("Boiler 3kW", { exact: true }).locator("..")
  const sw = boilerCard.getByRole("switch")

  await expect(sw).toHaveAttribute("aria-checked", "false")
  await sw.click()
  await expect(sw).toHaveAttribute("aria-checked", "true")  // applyMockService flipped it
  await sw.click()
  await expect(sw).toHaveAttribute("aria-checked", "false")
})

test("changing the inverter mode select reflects the new value", async ({ page }) => {
  await openControls(page)

  const card = page.getByText("Inverter Mode", { exact: true }).locator("..")
  const trigger = card.getByRole("combobox")
  await expect(trigger).toContainText("Auto")     // mock fixture default

  await trigger.click()
  await page.getByRole("option", { name: "Force Charge" }).click()
  await expect(trigger).toContainText("Force Charge")
})

test("theme toggle adds the dark class on <html>", async ({ page }) => {
  const html = page.locator("html")
  await expect(html).not.toHaveClass(/dark/)        // started in light (localStorage)

  await page.getByRole("button", { name: "Switch to dark mode" }).click()
  await expect(html).toHaveClass(/dark/)

  await page.getByRole("button", { name: "Switch to light mode" }).click()
  await expect(html).not.toHaveClass(/dark/)
})

test("language switcher flips the UI to Polish", async ({ page }) => {
  await expect(page.getByRole("tab", { name: "Home", exact: true })).toBeVisible()

  await page.getByRole("button", { name: /Switch language to PL/i }).click()

  // nav.rooms: "Home" (en) -> "Dom" (pl)
  await expect(page.getByRole("tab", { name: "Dom", exact: true })).toBeVisible()
  await expect(page.getByRole("tab", { name: "Home", exact: true })).toHaveCount(0)
})

test("Analytics section renders Reports by default and switches to Weather", async ({ page }) => {
  await page.getByRole("tab", { name: "Analytics", exact: true }).click()
  for (const sub of ["Reports", "Backtest", "Weather"]) {
    await expect(page.getByRole("tab", { name: sub, exact: true })).toBeVisible()
  }
  await page.getByRole("tab", { name: "Weather", exact: true }).click()
  await expect(page.getByRole("tab", { name: "Weather", exact: true }))
    .toHaveAttribute("data-state", "active")
})

test("Settings section shows the EMS thresholds panel", async ({ page }) => {
  await page.getByRole("tab", { name: "Settings", exact: true }).click()
  await expect(page.getByText("EMS Thresholds")).toBeVisible()
})
