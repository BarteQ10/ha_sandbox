// Dependency-free PDF export: build a clean, self-contained HTML report and let
// the browser's "Print → Save as PDF" produce the file. Keeps parity with the
// hand-rolled CSV export (no extra bundle weight). buildReportHTML is pure so it
// can be unit-tested; exportReportPDF opens a print window around it.
import type { DayReport } from "@/hooks/useWeekReport"

export interface ReportLabels {
  title: string
  period: string
  date: string
  pv: string
  net: string
  balance: string
  self: string
  total: string
  generated: string
}

export interface ReportTotals {
  totalPv: number
  totalNet: number
  totalCost: number
  avgSelf: number
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const sign = (n: number, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d)

/** Build a standalone printable HTML document for a report period. Pure. */
export function buildReportHTML(
  rows: DayReport[],
  totals: ReportTotals,
  labels: ReportLabels,
): string {
  const body = rows
    .map(
      (r) => `<tr>
      <td>${esc(r.date)}</td>
      <td class="num">${r.pvKwh.toFixed(2)}</td>
      <td class="num">${sign(r.netKwh)}</td>
      <td class="num">${sign(r.costPln)}</td>
      <td class="num">${r.selfPct.toFixed(0)}%</td>
    </tr>`,
    )
    .join("\n")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(labels.title)}</title>
<style>
  * { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  body { margin: 32px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #666; font-size: 12px; margin-bottom: 20px; }
  .cards { display: flex; gap: 12px; margin-bottom: 20px; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 10px 14px; }
  .card .k { color: #666; font-size: 11px; }
  .card .v { font-size: 18px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; }
  th { color: #666; font-weight: 600; border-bottom: 2px solid #ddd; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: 700; border-top: 2px solid #ddd; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
  <h1>${esc(labels.title)}</h1>
  <div class="sub">${esc(labels.period)} · ${esc(labels.generated)}</div>
  <div class="cards">
    <div class="card"><div class="k">${esc(labels.pv)}</div><div class="v">${totals.totalPv.toFixed(1)} kWh</div></div>
    <div class="card"><div class="k">${esc(labels.balance)}</div><div class="v">${sign(totals.totalCost)} PLN</div></div>
    <div class="card"><div class="k">${esc(labels.self)}</div><div class="v">${totals.avgSelf.toFixed(0)}%</div></div>
  </div>
  <table>
    <thead><tr>
      <th>${esc(labels.date)}</th>
      <th class="num">${esc(labels.pv)} (kWh)</th>
      <th class="num">${esc(labels.net)} (kWh)</th>
      <th class="num">${esc(labels.balance)} (PLN)</th>
      <th class="num">${esc(labels.self)}</th>
    </tr></thead>
    <tbody>
${body}
    </tbody>
    <tfoot><tr>
      <td>${esc(labels.total)}</td>
      <td class="num">${totals.totalPv.toFixed(2)}</td>
      <td class="num">${sign(totals.totalNet)}</td>
      <td class="num">${sign(totals.totalCost)}</td>
      <td class="num">${totals.avgSelf.toFixed(0)}%</td>
    </tr></tfoot>
  </table>
</body>
</html>`
}

/** Open a print window for the report so the user can save it as PDF. */
export function exportReportPDF(
  rows: DayReport[],
  totals: ReportTotals,
  labels: ReportLabels,
): void {
  const html = buildReportHTML(rows, totals, labels)
  const win = window.open("", "_blank")
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  // Give the new document a tick to lay out before invoking print.
  setTimeout(() => win.print(), 250)
}
