export function FlowGauge({
  label, value, max, unit, color,
}: {
  label: string; value: number; max: number; unit: string; color: string
}) {
  const pct = Math.min((value / max) * 100, 100)
  const circumference = 2 * Math.PI * 60
  const offset = circumference - (pct / 100) * circumference

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow p-4 text-center">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <svg width="120" height="120" viewBox="0 0 140 140" className="mx-auto text-foreground">
        <circle cx="70" cy="70" r="60" fill="none" stroke="currentColor" strokeWidth="10" opacity={0.15} />
        <circle
          cx="70" cy="70" r="60" fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 70 70)"
        />
        <text x="70" y="65" textAnchor="middle" fill="currentColor" fontSize="22" fontWeight="bold">
          {value}
        </text>
        <text x="70" y="85" textAnchor="middle" fill="currentColor" fontSize="12" opacity={0.5}>
          {unit}
        </text>
      </svg>
    </div>
  )
}
