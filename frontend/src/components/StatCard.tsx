import { Card, CardContent } from "@/components/ui/card"

export function StatCard({ label, value, unit, color, icon: Icon }: {
  label: string
  value: string
  unit: string
  color?: string
  icon?: React.ElementType
}) {
  return (
    <Card>
      <CardContent className="p-3 text-center sm:p-4">
        <p className="text-[11px] text-muted-foreground sm:text-xs">{label}</p>
        <div className="flex items-center justify-center gap-1">
          {Icon && <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" style={{ color }} />}
          <p className="text-lg font-bold sm:text-2xl" style={{ color }}>{value}</p>
          <span className="text-[10px] text-muted-foreground sm:text-xs">{unit}</span>
        </div>
      </CardContent>
    </Card>
  )
}
