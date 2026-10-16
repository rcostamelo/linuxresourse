import type { ReactNode } from 'react'
import { cn } from 'cn'
import { Card } from '@/components/ui/card'

export function StatCard({
  label,
  value,
  hint,
  icon,
  accent = 'text-foreground',
  children,
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  accent?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('gap-0 px-4 py-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', accent)}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
      {children}
    </Card>
  )
}
