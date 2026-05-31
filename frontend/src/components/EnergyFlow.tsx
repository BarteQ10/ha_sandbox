/**
 * EnergyFlow (5.4) — animated SVG energy-flow diagram.
 *
 * Accepts pre-computed battKw (already clamped by SoC and force mode in Flow.tsx)
 * and derives all per-path flows internally so arrows are always physically consistent.
 *
 * Flows computed:
 *   pvToLoad   — PV directly covering house load
 *   pvToBatt   — PV charging the battery
 *   pvToGrid   — PV export to grid (zero in blackout)
 *   battToLoad — Battery discharging to cover load deficit
 *   battToGrid — Battery discharging surplus → grid (force-discharge + PV > load)
 *   gridToLoad — Grid import covering remaining load deficit
 *   gridToBatt — Grid charging battery (force-charge when PV can't keep up)
 */

interface NodeProps {
  x: number; y: number
  label: string
  value: number   // displayed watts; 0 shows "—"
  unit: string
  color: string
  icon: string
}

function Node({ x, y, label, value, unit, color, icon }: NodeProps) {
  const display =
    value > 0
      ? `${value >= 1000 ? (value / 1000).toFixed(1) + "k" : Math.round(value)}${unit}`
      : "—"
  return (
    <g role="img" aria-label={`${label}: ${display}`}>
      <circle cx={x} cy={y} r={36} fill={color} fillOpacity={0.15} stroke={color} strokeWidth={2} />
      <text x={x} y={y - 10} textAnchor="middle" fontSize={18} dominantBaseline="middle">
        {icon}
      </text>
      <text x={x} y={y + 8} textAnchor="middle" fontSize={10} fill={color} fontWeight="600">
        {display}
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
  power: number
  color: string
  id: string
}

function FlowArrow({ x1, y1, x2, y2, power, color, id }: FlowArrowProps) {
  if (power < 5) return null

  const clamped = Math.min(power, 8000)
  const strokeWidth = 2 + (clamped / 8000) * 6
  const opacity = 0.4 + (clamped / 8000) * 0.6
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const markerId = `arrow-${id}`

  return (
    <g>
      <defs>
        <marker id={markerId} markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
          <path d="M0,0 L0,6 L8,3 z" fill={color} opacity={opacity} />
        </marker>
      </defs>
      <path
        d={`M ${x1},${y1} Q ${mx},${my} ${x2},${y2}`}
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
          from="40"
          to="0"
          dur="1.4s"
          repeatCount="indefinite"
        />
      </path>
    </g>
  )
}

interface EnergyFlowProps {
  pv: number        // W — PV production
  soc: number       // % — battery SoC for display
  load: number      // W — total house load
  battKw: number    // W — positive = charging, negative = discharging (clamped by caller)
  isBlackout: boolean
}

export function EnergyFlow({ pv, soc, load, battKw, isBlackout }: EnergyFlowProps) {
  // ── derive per-path flows ──────────────────────────────────────────────────
  const battDischarge = Math.max(0, -battKw)  // W leaving battery
  const battCharge    = Math.max(0,  battKw)  // W entering battery

  const pvToLoad  = Math.min(pv, load)                               // PV → Load (direct)
  const deficit   = Math.max(0, load - pv)                           // load not met by PV

  const battToLoad = Math.min(battDischarge, deficit)                 // battery covers deficit first
  const battToGrid = isBlackout ? 0 : Math.max(0, battDischarge - battToLoad) // remainder → grid

  const pvToBatt  = battCharge                                        // PV → Battery
  const pvToGrid  = isBlackout ? 0 : Math.max(0, pv - pvToLoad - pvToBatt)   // PV surplus → grid

  const gridToLoad = isBlackout ? 0 : Math.max(0, deficit - battToLoad)       // grid makes up rest
  // Grid charging battery: when force-charging and PV can't cover full charge demand
  const gridToBatt = isBlackout ? 0 : Math.max(0, battCharge - Math.max(0, pv - load))

  // ── node display values ───────────────────────────────────────────────────
  const battDisplayW = battDischarge > 0 ? battDischarge : battCharge  // show active power direction
  const gridDisplayW = isBlackout ? 0 : Math.max(gridToLoad + gridToBatt, pvToGrid + battToGrid)

  // ── node positions (320 × 220 viewport) ──────────────────────────────────
  const pvPos   = { x: 60,  y: 50  }
  const gridPos = { x: 260, y: 50  }
  const battPos = { x: 60,  y: 170 }
  const loadPos = { x: 260, y: 170 }

  return (
    <figure aria-label="Energy flow diagram" className="w-full">
      <svg
        viewBox="0 0 320 220"
        className="mx-auto w-full max-w-xs sm:max-w-sm"
        role="img"
        aria-label={`PV ${pv}W, Load ${load}W, Battery ${soc}% SoC`}
      >
        {/* PV → Load */}
        <FlowArrow id="pv-load"   x1={pvPos.x+36}  y1={pvPos.y}     x2={loadPos.x-36} y2={loadPos.y}    power={pvToLoad}   color="#66bb6a" />
        {/* PV → Battery */}
        <FlowArrow id="pv-batt"   x1={pvPos.x}     y1={pvPos.y+36}  x2={battPos.x}    y2={battPos.y-36} power={pvToBatt}   color="#4fc3f7" />
        {/* PV → Grid */}
        <FlowArrow id="pv-grid"   x1={pvPos.x+36}  y1={pvPos.y}     x2={gridPos.x-36} y2={gridPos.y}    power={pvToGrid}   color="#66bb6a" />
        {/* Battery → Load */}
        <FlowArrow id="batt-load" x1={battPos.x+36} y1={battPos.y}  x2={loadPos.x-36} y2={loadPos.y}    power={battToLoad} color="#4fc3f7" />
        {/* Battery → Grid (force-discharge surplus) */}
        <FlowArrow id="batt-grid" x1={battPos.x+36} y1={battPos.y}  x2={gridPos.x-36} y2={gridPos.y}    power={battToGrid} color="#4fc3f7" />
        {/* Grid → Load */}
        <FlowArrow id="grid-load" x1={gridPos.x}    y1={gridPos.y+36} x2={loadPos.x}  y2={loadPos.y-36} power={gridToLoad} color="#ef5350" />
        {/* Grid → Battery */}
        <FlowArrow id="grid-batt" x1={gridPos.x}    y1={gridPos.y+36} x2={battPos.x+36} y2={battPos.y}  power={gridToBatt} color="#ef5350" />

        {/* Nodes */}
        <Node {...pvPos}   label="PV"           value={pv}           unit="W" color="#66bb6a" icon="☀️" />
        <Node {...gridPos}
          label={isBlackout ? "Blackout" : "Grid"}
          value={gridDisplayW}
          unit="W"
          color={isBlackout ? "#9e9e9e" : gridToLoad + gridToBatt > pvToGrid + battToGrid ? "#ef5350" : "#66bb6a"}
          icon={isBlackout ? "⛔" : "🔌"}
        />
        <Node {...battPos} label={`Batt ${soc}%`} value={battDisplayW} unit="W" color="#4fc3f7" icon="🔋" />
        <Node {...loadPos} label="Load"           value={load}         unit="W" color="#ffa726" icon="🏠" />
      </svg>
      <figcaption className="sr-only">
        Energy flow: PV {pv}W, house {load}W,
        battery {soc}% {battKw > 0 ? `charging ${battKw}W` : battKw < 0 ? `discharging ${-battKw}W` : "idle"}.
        {isBlackout ? " Grid offline (blackout)." : gridToLoad > 0 ? ` Importing ${Math.round(gridToLoad)}W from grid.` : pvToGrid + battToGrid > 0 ? ` Exporting ${Math.round(pvToGrid + battToGrid)}W to grid.` : ""}
      </figcaption>
    </figure>
  )
}
