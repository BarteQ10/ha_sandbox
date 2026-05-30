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
      <CardContent className="p-4 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="flex items-center justify-center gap-1">
          {Icon && <Icon className="h-4 w-4" style={{ color }} />}
          <p className="text-2xl font-bold" style={{ color }}>{value}</p>
          <span className="text-xs text-muted-foreground">{unit}</span>
        </div>
      </CardContent>
    </Card>
  )
}
