import { useMemo } from 'react'
import { Cpu, HardDrive, Layers, MemoryStick, RefreshCw } from '@/components/ui/lucide-animated'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { StatCard } from '@/components/StatCard'
import { api } from '@/lib/api'
import { usePoll } from '@/lib/usePoll'
import { formatBytes } from '@/lib/format'

export function MemoryPanel() {
  const { data: mem, error } = usePoll(api.memory, 2000)
  const { data: proc } = usePoll(api.processes, 2000)

  const usedPct = mem ? (mem.used / mem.total) * 100 : 0
  const swapPct = mem && mem.swapTotal ? (mem.swapUsed / mem.swapTotal) * 100 : 0

  const topMem = useMemo(
    () => [...(proc?.processes ?? [])].sort((a, b) => b.mem - a.mem).slice(0, 12),
    [proc],
  )

  if (!mem) {
    return (
      <div className="grid h-40 place-items-center text-sm text-muted-foreground">
        {error ? <span className="text-destructive">API offline: {error}</span> : 'Carregando memória…'}
      </div>
    )
  }

  const cache = mem.cached + mem.buffers
  const breakdown = [
    { label: 'Disponível', value: mem.available, color: 'bg-emerald-400' },
    { label: 'Cache', value: mem.cached, color: 'bg-amber-400' },
    { label: 'Buffers', value: mem.buffers, color: 'bg-violet-400' },
    { label: 'Compartilhada', value: mem.shared, color: 'bg-sky-400' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="RAM em uso"
          value={formatBytes(mem.used, 1)}
          hint={`${usedPct.toFixed(1)}% de ${formatBytes(mem.total, 1)}`}
          icon={<MemoryStick className="size-4 text-violet-400" />}
        />
        <StatCard
          label="Disponível"
          value={formatBytes(mem.available, 1)}
          hint="estimativa p/ novos apps"
          icon={<MemoryStick className="size-4 text-emerald-400" />}
        />
        <StatCard
          label="Cache + Buffers"
          value={formatBytes(cache, 1)}
          hint="recuperável sob pressão"
          icon={<Layers className="size-4 text-amber-400" />}
        />
        <StatCard
          label="Swap em uso"
          value={formatBytes(mem.swapUsed, 1)}
          hint={`${swapPct.toFixed(1)}% de ${formatBytes(mem.swapTotal, 1)}`}
          icon={<HardDrive className="size-4 text-rose-400" />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MemoryStick className="size-4 text-violet-400" /> Memória RAM
            </CardTitle>
            <CardDescription>
              {formatBytes(mem.used, 1)} usados de {formatBytes(mem.total, 1)} · {usedPct.toFixed(1)}%
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress
              value={usedPct}
              className="h-3"
            />
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
              {breakdown.map((b) => (
                <div
                  key={b.label}
                  className={b.color}
                  style={{ width: `${(b.value / mem.total) * 100}%` }}
                  title={`${b.label}: ${formatBytes(b.value, 1)}`}
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {breakdown.map((b) => (
                <div key={b.label} className="flex items-center gap-2 text-sm">
                  <i className={`size-2.5 rounded-full ${b.color}`} />
                  <span className="text-muted-foreground">{b.label}</span>
                  <span className="ml-auto font-mono text-xs tabular-nums">{formatBytes(b.value, 1)}</span>
                </div>
              ))}
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Ativa" value={formatBytes(mem.active, 1)} />
              <Field label="Inativa" value={formatBytes(mem.inactive, 1)} />
              <Field label="Suja (dirty)" value={formatBytes(mem.dirty, 1)} />
              <Field label="Livre" value={formatBytes(mem.free, 1)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="size-4 text-sky-400" /> Swap
            </CardTitle>
            <CardDescription>
              {formatBytes(mem.swapUsed, 1)} usados de {formatBytes(mem.swapTotal, 1)} · {swapPct.toFixed(1)}%
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={swapPct} className="h-3" />
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Usado" value={formatBytes(mem.swapUsed, 1)} />
              <Field label="Livre" value={formatBytes(mem.swapFree, 1)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Swap alto pode indicar falta de RAM ou processos ociosos que foram paginados para o disco.
              Considere identificar e encerrar os maiores consumidores abaixo.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="size-4 text-amber-400" /> Maiores consumidores de memória
          </CardTitle>
          <CardDescription>Top {topMem.length} processos por RSS</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {topMem.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" /> Coletando…
            </div>
          ) : (
            topMem.map((p) => {
              const pct = (p.mem / mem.total) * 100
              return (
                <div key={p.pid} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="outline" className="h-5 shrink-0 font-mono text-[10px]">
                      {p.pid}
                    </Badge>
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.user}</span>
                  </div>
                  <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-muted sm:block">
                    <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-20 text-right font-mono text-xs tabular-nums">
                    {formatBytes(p.mem, 1)}
                  </span>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/50 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-sm tabular-nums">{value}</div>
    </div>
  )
}
