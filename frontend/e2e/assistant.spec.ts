import { test, expect, type Page } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
    window.localStorage.setItem("ems-theme", "light")
  })
  // Default: the backend LLM (layer 2) doesn't recognise anything. Individual
  // tests re-route /assistant to override. (Playwright: last route wins.)
  await page.route("**localhost:8088/assistant", (route) =>
    route.fulfill({ json: { intent: "unknown", value: null, enabled: true } }))
  await page.goto("/")
})

// The assistant is a global floating button (FAB) — open it from any tab.
async function openAssistant(page: Page) {
  await page.getByRole("button", { name: "Assistant", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Assistant" })).toBeVisible()
}

test("FAB is available on every tab without navigation", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Assistant", exact: true })).toBeVisible()
  await page.getByRole("tab", { name: "Monitoring", exact: true }).click()
  await expect(page.getByRole("button", { name: "Assistant", exact: true })).toBeVisible()
})

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

test("raises the temperature with a relative command", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("zwiększ temperaturę")
  await page.getByRole("button", { name: "Send" }).click()
  // salon setpoint fixture is 21 → +1 = 22
  await expect(page.getByText(/raised to 22/)).toBeVisible()
})

test("sets an absolute temperature", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("ustaw temperaturę na 24 stopnie")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText(/set to 24°C/)).toBeVisible()
})

test("turns on the light in the named room (not the default salon)", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("zapal światło w kuchni")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Kitchen light on.")).toBeVisible()
  await expect(page.getByText(/Living-room/i)).toHaveCount(0)
})

test("controls the media player", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("zatrzymaj muzykę")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Stopped.")).toBeVisible()
})

test("turns on a named light fixture", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("zapal lampkę nocną")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText(/night lamp/i)).toBeVisible()
})

test("sets the heat-pump mode", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("ustaw pompę ciepła na boost")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Heat pump set to Boost.")).toBeVisible()
})

test("triggers a grid blackout", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("ustaw blackout")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText(/Blackout/)).toBeVisible()
})

test("closes blinds in the named room", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("zamknij rolety w kuchni")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Kitchen blinds closed.")).toBeVisible()
})

test("turns off all lights via a scene phrase", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("zgaś wszystkie światła")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("All lights off.")).toBeVisible()
})

test("runs a multi-action scene", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("dobranoc")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText(/Good night/i)).toBeVisible()
})

test("follow-up command re-targets the last device", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("włącz bojler")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Boiler turned on.")).toBeVisible()

  // bare "wyłącz" with no device → applies to the boiler from context
  await page.getByRole("textbox").fill("a teraz wyłącz")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Boiler turned off.")).toBeVisible()
})

test("offers choices for an ambiguous command and runs the picked one", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("włącz")
  await page.getByRole("button", { name: "Send" }).click()

  await expect(page.getByText(/Did you mean/i)).toBeVisible()
  // Pick the boiler option (button labelled with its confirmation phrase).
  await page.getByRole("button", { name: "Boiler turned on." }).click()
  await expect(page.getByText("Boiler turned on.").last()).toBeVisible()
})

test("falls back to the local LLM for a phrase the parser misses", async ({ page }) => {
  // "podgrzej wodę" has no rule match → goes to /assistant, which (mocked here)
  // classifies it as boiler_on.
  await page.route("**localhost:8088/assistant", (route) =>
    route.fulfill({ json: { intent: "boiler_on", value: null, enabled: true } }))

  await openAssistant(page)
  await page.getByRole("textbox").fill("podgrzej wodę w zbiorniku")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Boiler turned on.")).toBeVisible()
})

test("set_ev intent from the LLM carries the wattage value", async ({ page }) => {
  await page.route("**localhost:8088/assistant", (route) =>
    route.fulfill({ json: { intent: "set_ev", value: 6000, enabled: true } }))

  await openAssistant(page)
  // Phrase the parser misses and the disambiguator doesn't claim → reaches the LLM.
  await page.getByRole("textbox").fill("ustaw moc ładowarki auta na maksa")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText(/6000/)).toBeVisible()
})

test("command actually changes device state (end-to-end through the mock)", async ({ page }) => {
  await openAssistant(page)
  await page.getByRole("textbox").fill("turn on the boiler")
  await page.getByRole("button", { name: "Send" }).click()
  await expect(page.getByText("Boiler turned on.")).toBeVisible()

  // Close the assistant, then verify the boiler switch in Controls reflects it.
  await page.getByRole("button", { name: "Assistant", exact: true }).click()
  await page.getByRole("tab", { name: "Energy", exact: true }).click()
  await page.getByRole("tab", { name: "Controls", exact: true }).click()
  const boiler = page.getByText("Boiler 3kW", { exact: true }).locator("..").getByRole("switch")
  await expect(boiler).toHaveAttribute("aria-checked", "true")
})
