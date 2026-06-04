import { test, expect } from "@playwright/test"

// Reports reads per-day history from HA's REST API. Stub it so the table (and
// thus the export buttons) populate without a real Home Assistant recorder.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
    window.localStorage.setItem("ems-theme", "light")
    // Count PDF-export window.open() calls without spawning real popups.
    ;(window as unknown as { __pdfOpened: number }).__pdfOpened = 0
    window.open = () => {
      ;(window as unknown as { __pdfOpened: number }).__pdfOpened++
      return null
    }
  })

  await page.route("**/api/history/period/**", (route) => {
    const url = new URL(route.request().url())
    const ids = (url.searchParams.get("filter_entity_id") || "").split(",").filter(Boolean)
    const today = new Date().toISOString()
    const body = ids.map((id) => [
      {
        entity_id: id,
        state: id.includes("pv") ? "10.5" : id.includes("netto") ? "2.0" : "1.5",
        last_changed: today,
      },
    ])
    route.fulfill({ json: body })
  })

  await page.goto("/")
  await page.getByRole("tab", { name: "Analytics", exact: true }).click()
  await page.getByRole("tab", { name: "Reports", exact: true }).click()
})

test("switches between weekly and monthly period", async ({ page }) => {
  const month = page.getByRole("button", { name: "Month", exact: true })
  const week = page.getByRole("button", { name: "Week", exact: true })

  await expect(week).toHaveClass(/bg-primary/)      // week is the default
  await month.click()
  await expect(month).toHaveClass(/bg-primary/)     // month now active
  await expect(page.getByText("This month")).toBeVisible()
})

test("exports the report to PDF (opens a print window)", async ({ page }) => {
  const pdfBtn = page.getByRole("button", { name: "Export PDF" })
  await expect(pdfBtn).toBeVisible()

  await pdfBtn.click()
  const opened = await page.evaluate(
    () => (window as unknown as { __pdfOpened: number }).__pdfOpened,
  )
  expect(opened).toBeGreaterThan(0)
})
