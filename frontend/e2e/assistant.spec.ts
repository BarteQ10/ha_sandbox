import { test, expect, type Page } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
    window.localStorage.setItem("ems-theme", "light")
  })
  await page.goto("/")
})

async function openAssistant(page: Page) {
  await page.getByRole("tab", { name: "Energy", exact: true }).click()
  await page.getByRole("tab", { name: "Assistant", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Assistant" })).toBeVisible()
}

test("understands a command and confirms it", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("turn on the boiler")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Boiler turned on.")).toBeVisible()
})

test("rejects an unrecognised command", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("make me a sandwich")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText(/didn't understand/i)).toBeVisible()
})

test("example chip dispatches a command", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("button", { name: "set inverter to charge" }).click()
  await expect(page.getByText("Inverter set to Force Charge.")).toBeVisible()
})

test("command actually changes device state (end-to-end through the mock)", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("turn on the boiler")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Boiler turned on.")).toBeVisible()

  // Switch to Controls — the boiler switch must reflect the assistant's action.
  await page.getByRole("tab", { name: "Controls", exact: true }).click()
  const boiler = page.getByText("Boiler 3kW", { exact: true }).locator("..").getByRole("switch")
  await expect(boiler).toHaveAttribute("aria-checked", "true")
})
