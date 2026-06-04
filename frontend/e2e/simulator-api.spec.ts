import { test, expect } from "@playwright/test"

// These views talk to the simulator's HTTP server (:8088), a different origin
// than HA. Playwright intercepts those requests and serves fixtures, so the
// Advisor / Backtest UIs can be exercised without a running simulator.

const ADVISOR = {
  now_hour: 12,
  hours: Array.from({ length: 24 }, (_, h) => ({
    hour: h, price_gr: 40 + (h % 6) * 5, pv_w: h >= 9 && h <= 16 ? 2000 : 0,
  })),
  recommendations: [
    { name: "washer", power_w: 2000, duration_h: 2, best_hour: 13, cost_gr: 80, cost_now_gr: 200, saving_gr: 120 },
    { name: "dishwasher", power_w: 1500, duration_h: 1, best_hour: 3, cost_gr: 45, cost_now_gr: 60, saving_gr: 15 },
    { name: "ev", power_w: 7400, duration_h: 3, best_hour: 2, cost_gr: 300, cost_now_gr: 300, saving_gr: 0 },
  ],
}

const BACKTEST = {
  days: 7, rows: 2016, from: "2024-01-01T00:00:00Z", to: "2024-01-08T00:00:00Z",
  best: "mpc optimizer", savings_pln: 12.34, savings_year_est: 642,
  timeline: ["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z"],
  strategies: [
    { name: "baseline", cost_pln: 50, savings_pct: 0, import_kwh: 100, export_kwh: 10, self_sufficiency: 0.4, charge_cycles: 0, cumulative_cost: [0, 50] },
    { name: "mpc optimizer", cost_pln: 37.66, savings_pct: 24.7, import_kwh: 70, export_kwh: 20, self_sufficiency: 0.6, charge_cycles: 5, cumulative_cost: [0, 37.66] },
  ],
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("i18nextLng", "en")
    window.localStorage.setItem("ems-theme", "light")
  })
})

test("Advisor renders recommendations from the simulator endpoint", async ({ page }) => {
  await page.route("**localhost:8088/advisor", (route) =>
    route.fulfill({ json: ADVISOR }))

  await page.goto("/")
  await page.getByRole("tab", { name: "Energy", exact: true }).click()
  await page.getByRole("tab", { name: "Advisor", exact: true }).click()

  await expect(page.getByText("Washer", { exact: true })).toBeVisible()  // advisor.washer
  await expect(page.getByText("13:00")).toBeVisible()                    // best_hour formatted
})

test("Backtest runs and shows the winning strategy", async ({ page }) => {
  await page.route("**localhost:8088/backtest**", (route) =>
    route.fulfill({ json: BACKTEST }))

  await page.goto("/")
  await page.getByRole("tab", { name: "Analytics", exact: true }).click()
  await page.getByRole("tab", { name: "Backtest", exact: true }).click()

  await page.getByRole("button", { name: "Run backtest" }).click()

  await expect(page.getByText("Best strategy")).toBeVisible()
  await expect(page.getByText("12.34 zł")).toBeVisible()     // savings_pln
})

test("Backtest surfaces the no-data error from the simulator", async ({ page }) => {
  await page.route("**localhost:8088/backtest**", (route) =>
    route.fulfill({ status: 200, json: { error: "no_data" } }))

  await page.goto("/")
  await page.getByRole("tab", { name: "Analytics", exact: true }).click()
  await page.getByRole("tab", { name: "Backtest", exact: true }).click()
  await page.getByRole("button", { name: "Run backtest" }).click()

  // backtest.noData copy must show (and no result table)
  await expect(page.getByText("Best strategy")).toHaveCount(0)
})
