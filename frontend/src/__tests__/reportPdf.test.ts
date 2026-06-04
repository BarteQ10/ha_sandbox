import { describe, it, expect } from "vitest"
import { buildReportHTML, type ReportLabels, type ReportTotals } from "@/lib/reportPdf"
import type { DayReport } from "@/hooks/useWeekReport"

const LABELS: ReportLabels = {
  title: "EMS Energy Report",
  period: "May 2024",
  date: "Day",
  pv: "PV",
  net: "Net balance",
  balance: "Finances",
  self: "Self-consumption",
  total: "Total",
  generated: "2024-05-31 12:00",
}

const TOTALS: ReportTotals = { totalPv: 123.4, totalNet: -5.6, totalCost: 7.8, avgSelf: 64 }

const ROWS: DayReport[] = [
  { date: "2024-05-01", label: "1", pvKwh: 12.34, netKwh: 2.5, costPln: 1.2, selfPct: 80 },
  { date: "2024-05-02", label: "2", pvKwh: 9.0, netKwh: -1.0, costPln: -0.5, selfPct: 60 },
]

describe("buildReportHTML", () => {
  it("produces a standalone HTML document", () => {
    const html = buildReportHTML(ROWS, TOTALS, LABELS)
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("<title>EMS Energy Report</title>")
    expect(html).toContain("May 2024")
  })

  it("renders a row per day with formatted numbers", () => {
    const html = buildReportHTML(ROWS, TOTALS, LABELS)
    expect(html).toContain("2024-05-01")
    expect(html).toContain("12.34")
    expect(html).toContain("+2.50")   // positive net signed
    expect(html).toContain("-0.50")   // negative cost signed
  })

  it("includes a totals footer", () => {
    const html = buildReportHTML(ROWS, TOTALS, LABELS)
    expect(html).toContain("123.40")  // totalPv
    expect(html).toContain("64%")     // avgSelf
  })

  it("escapes HTML-special characters in labels", () => {
    const html = buildReportHTML(ROWS, TOTALS, { ...LABELS, title: "A & B <x>" })
    expect(html).toContain("A &amp; B &lt;x&gt;")
    expect(html).not.toContain("A & B <x>")
  })
})
