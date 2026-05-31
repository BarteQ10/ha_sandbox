/**
 * EnergyFlow (5.4) — animated SVG energy-flow diagram.
 *
 * Shows four nodes (PV, Battery, Grid, Load) with animated dashed arrows
 * whose width and opacity scale with actual power.  Arrows disappear when
 * the corresponding flow is zero.
 */

interface NodeProps {
  x: number
  y: number
  label: string
  value: number
  unit: string
  color: string
  icon: string   // emoji / short label
}

function Node({ x, y, label, value, unit, color, icon }: NodeProps) {
  return (
    <g role="img" aria-label={`${label}: ${value} ${unit}`}>
      <circle cx={x} cy={y} r={36} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} />
      <text x={x} y={y - 10} textAnchor="middle" fontSize={18} dominantBaseline="middle">
        {icon}
      </text>
      <text x={x} y={y + 8} textAnchor="middle" fontSize={10} fill={color} fontWeight="600">
        {value > 0 ? `${value >= 1000 ? (value / 1000).toFixed(1) + "k" : value}${unit}` : "—"}
      </text>
      <text x={x} y={y + 20} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.6}>
        {label}
      </text>
    </g>
  )
}

interface FlowArrowProps {
  x1: number; y1: number
  x2: number; y2: number
  power: number    // W — determines width and opacity
  color: string
  id: string
  reverse?: boolean  // if true, arrow points from (x2,y2) to (x1,y1)
}

function FlowArrow({ x1, y1, x2, y2, power, color, id, reverse }: FlowArrowProps) {
  if (power < 5) return null

  const clamped = Math.min(power, 8000)
  const strokeWidth = 2 + (clamped / 8000) * 6
  const opacity = 0.4 + (clamped / 8000) * 0.6

  // Midpoint offset for slight curve
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2

  const [ax, ay, bx, by] = reverse ? [x2, y2, x1, y1] : [x1, y1, x2, y2]

  // Arrow marker
  const markerId = `arrow-${id}`

  return (
    <g>
      <defs>
        <marker id={markerId} markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={color} opacity={opacity} />
        </marker>
      </defs>
      <path
        d={`M ${ax},${ay} Q ${mx},${my} ${bx},${by}`}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeOpacity={opacity}
        strokeDasharray="6 4"
        markerEnd={`url(#${markerId})`}
        aria-hidden="true"
      >
        <animate
          attributeName="stroke-dashoffset"
          from={reverse ? "0" : "40"}
          to={reverse ? "40" : "0"}
          dur="1.4s"
          repeatCount="indefinite"
        />
      </path>
    </g>
  )
}

interface EnergyFlowProps {
  pv: number     // W — PV production
  soc: number    // % — battery SoC (used for display, not flow calc)
  load: number   // W — total house load
  battKw: number // W — positive = charging, negative = discharging
  importW: number  // W — grid import
  exportW: number  // W — grid export
}

export function EnergyFlow({ pv, soc, load, battKw, importW, exportW }: EnergyFlowProps) {
  // Node positions in a 320×220 SVG viewport
  const pvPos    = { x: 60,  y: 50  }   // top-left
  const gridPos  = { x: 260, y: 50  }   // top-right
  const battPos  = { x: 60,  y: 170 }   // bottom-left
  const loadPos  = { x: 260, y: 170 }   // bottom-right

  const pvToLoad    = Math.max(0, Math.min(pv, load))
  const pvToBatt    = battKw > 0 ? battKw : 0
  const pvToGrid    = exportW
  const battToLoad  = battKw < 0 ? -battKw : 0
  const gridToLoad  = importW
  const gridToBatt  = battKw > 0 && importW > 0 ? Math.min(battKw, importW) : 0

  return (
    <figure aria-label="Energy flow diagram" className="w-full">
      <svg
        viewBox="0 0 320 220"
        className="mx-auto w-full max-w-xs sm:max-w-sm"
        role="img"
        aria-label={`Energy flow: PV ${pv}W, Load ${load}W, Battery SoC ${soc}%`}
      >
        {/* Flows */}
        <FlowArrow id="pv-load"   x1={pvPos.x + 36} y1={pvPos.y}    x2={loadPos.x - 36} y2={loadPos.y}   power={pvToLoad}   color="#66bb6a" />
        <FlowArrow id="pv-batt"   x1={pvPos.x}      y1={pvPos.y+36} x2={battPos.x}      y2={battPos.y-36} power={pvToBatt}   color="#4fc3f7" />
        <FlowArrow id="pv-grid"   x1={pvPos.x+36}   y1={pvPos.y}    x2={gridPos.x-36}   y2={gridPos.y}   power={pvToGrid}   color="#66bb6a" />
        <FlowArrow id="batt-load" x1={battPos.x+36} y1={battPos.y}  x2={loadPos.x-36}   y2={loadPos.y}   power={battToLoad} color="#4fc3f7" />
        <FlowArrow id="grid-load" x1={gridPos.x}    y1={gridPos.y+36} x2={loadPos.x}    y2={loadPos.y-36} power={gridToLoad} color="#ef5350" />
        <FlowArrow id="grid-batt" x1={gridPos.x}    y1={gridPos.y+36} x2={battPos.x+36} y2={battPos.y}  power={gridToBatt} color="#ef5350" />

        {/* Nodes */}
        <Node {...pvPos}   label="PV"      value={Math.round(pv)}   unit="W" color="#66bb6a" icon="☀️" />
        <Node {...gridPos} label="Grid"    value={Math.round(Math.max(importW, exportW))} unit="W" color={importW > exportW ? "#ef5350" : "#66bb6a"} icon="🔌" />
        <Node {...battPos} label={`Batt ${soc}%`} value={Math.abs(Math.round(battKw))} unit="W" color="#4fc3f7" icon="🔋" />
        <Node {...loadPos} label="Load"    value={Math.round(load)} unit="W" color="#ffa726" icon="🏠" />
      </svg>
      <figcaption className="sr-only">
        Energy flow: PV producing {pv}W, house consuming {load}W,
        battery at {soc}% SoC {battKw > 0 ? `charging at ${battKw}W` : battKw < 0 ? `discharging at ${-battKw}W` : "idle"},
        {importW > 0 ? ` importing ${importW}W from grid` : exportW > 0 ? ` exporting ${exportW}W to grid` : " grid neutral"}.
      </figcaption>
    </figure>
  )
}
