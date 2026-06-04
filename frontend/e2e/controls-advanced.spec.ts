import { test, expect, type Page } from "@playwright/test"

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

test("EV charge-limit slider increments via keyboard and commits", async ({ page }) => {
  await openControls(page)
  // Card label is "EV Charge Limit: <value> W" (live display from the entity).
  const card = page.getByText(/EV Charge Limit:/).locator("..")
  await expect(card).toContainText("3700")        // mock fixture

  const slider = card.getByRole("slider")
  await slider.focus()
  await slider.press("ArrowRight")                // +step (100) → committed 3800
  await expect(card).toContainText("3800")        // entity updated via mock service
})

test("storm safeguard activate flips the card border to red", async ({ page }) => {
  await openControls(page)
  const stormCard = page
    .getByText("Storm Safeguard")
    .locator("xpath=ancestor::div[contains(@class,'border-2')][1]")

  await expect(stormCard).toHaveClass(/border-gray-700/)   // off
  await stormCard.getByRole("button", { name: "ACTIVATE", exact: true }).click()
  await expect(stormCard).toHaveClass(/border-red-500/)    // on (mock turned it on)
})

test("presence mode select switches to Away", async ({ page }) => {
  await openControls(page)
  const card = page.getByText("Presence Mode", { exact: true }).locator("..")
  const trigger = card.getByRole("combobox")
  await expect(trigger).toContainText("W domu")            // mock fixture default

  await trigger.click()
  await page.getByRole("option", { name: "Poza domem" }).click()
  await expect(trigger).toContainText("Poza domem")
})
