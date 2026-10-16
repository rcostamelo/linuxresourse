import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  Gauge as GaugeIcon,
  HardDrive,
  MemoryStick,
  Network,
  Radio,
  Zap,
} from '@/components/ui/lucide-animated'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AreaSeries, Gauge, Sparkline } from '@/components/charts'
import { api } from '@/lib/api'
import type { ProcInfo } from '@/lib/api'
import { usePoll } from '@/lib/usePoll'
import { formatBytes, formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

const C = {
  cpu: '#10b981',
  mem: '#8b5cf6',
  rx: '#38bdf8',
  tx: '#e879f9',
  disk: '#f59e0b',
}

const formatRate = (bps: number) => `${formatBytes(bps, 1)}/s`
const isVirtual = (name: string) => /^(veth|br-|docker|virbr|lo$|tun|tap)/.test(name)

function GaugeCard({
  title,
  icon,
  value,
  unit,
  decimals,
  color,
  sub,
  hint,
}: {
  title: string
  icon: React.ReactNode
  value: number
  unit?: string
  decimals?: number
  color?: string
  sub?: string
  hint?: string
}) {
  return (
    <Card className="items-center gap-0 py-5">
      <div className="flex w-full items-center justify-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
      </div>
      <Gauge value={value} unit={unit} decimals={decimals} color={color} label={sub} />
      {hint ? <div className="px-3 text-center text-[11px] text-muted-foreground">{hint}</div> : null}
    </Card>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className="size-2.5 rounded-full" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground tabular-nums">{value}</span>
    </span>
  )
}

export function Dashboard() {
  const { data: metrics } = usePoll(api.metrics, 2000)
  const { data: history } = usePoll(api.history, 2000)
  const { data: procs } = usePoll(api.processes, 2000)
  const { data: net } = usePoll(api.network, 4000)
  const { data: disksData } = usePoll(api.disks, 15000)
  const [showVirtual, setShowVirtual] = useState(false)

  const sys = metrics?.system
  const mem = metrics?.memory
  const rates = metrics?.network

  const series = useMemo(() => {
    const p = history?.points ?? []
    return { cpu: p.map((x) => x.cpu), mem: p.map((x) => x.mem), rx: p.map((x) => x.rx), tx: p.map((x) => x.tx), n: p.length }
  }, [history])

  const memPct = mem ? (mem.used / mem.total) * 100 : 0
  const diskSummary = disksData?.summary
  const diskMounts = disksData?.mounts ?? []
  const diskPct = diskSummary?.usedPct ?? 0

  const topCpu = useMemo(() => [...(procs?.processes ?? [])].sort((a, b) => b.cpu - a.cpu).slice(0, 6), [procs])
  const topMem = useMemo(() => [...(procs?.processes ?? [])].sort((a, b) => b.mem - a.mem).slice(0, 6), [procs])

  const ifaces = useMemo(
    () => (net?.interfaces ?? []).filter((i) => showVirtual || !isVirtual(i.name)),
    [net, showVirtual],
  )

  const cpuHigh = (sys?.cpuUsage ?? 0) >= 85

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <GaugeCard
          title="CPU"
          icon={<Cpu className="size-3.5" />}
          value={sys?.cpuUsage ?? 0}
          sub={sys ? `${formatDuration(sys.uptime)} no ar` : ''}
          hint={sys ? `${sys.ncpu} núcleos · load ${sys.loadavg.map((l) => l.toFixed(1)).join(' · ')}` : '—'}
        />
        <GaugeCard
          title="Memória"
          icon={<MemoryStick className="size-3.5" />}
          value={memPct}
          color={C.mem}
          sub={mem ? formatBytes(mem.used, 1) : ''}
          hint={mem ? `${formatBytes(mem.used, 1)} de ${formatBytes(mem.total, 1)} · swap ${formatBytes(mem.swapUsed, 1)}` : '—'}
        />
        <GaugeCard
          title={diskMounts.length > 1 ? `Discos (${diskMounts.length})` : 'Disco /'}
          icon={<HardDrive className="size-3.5" />}
          value={diskPct}
          color={C.disk}
          sub={diskSummary ? formatBytes(diskSummary.used, 1) : ''}
          hint={
            diskSummary
              ? `${formatBytes(diskSummary.free, 1)} livres de ${formatBytes(diskSummary.total, 1)}${
                  diskMounts.length > 1 ? ` · ${diskMounts.map((m) => `${m.name} (${m.usedPct.toFixed(0)}%)`).join(' + ')}` : ''
                }`
              : '—'
          }
        />
        <Card className="gap-2 overflow-hidden py-4">
          <div className="flex items-center justify-between px-4">
            <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <Network className="size-3.5" /> Rede
            </div>
            <Badge variant={net?.latency != null ? 'secondary' : 'outline'} className="gap-1">
              <Radio className={cn('size-3', net?.latency != null && 'text-emerald-400')} />
              {net?.latency != null ? `${net.latency} ms` : 'offline'}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 px-4">
            <div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowDown className="size-3 text-sky-400" /> Download
              </div>
              <div className="font-mono text-lg font-semibold text-sky-400 tabular-nums">{formatRate(rates?.rx ?? 0)}</div>
            </div>
            <div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowUp className="size-3 text-fuchsia-400" /> Upload
              </div>
              <div className="font-mono text-lg font-semibold text-fuchsia-400 tabular-nums">{formatRate(rates?.tx ?? 0)}</div>
            </div>
          </div>
          <div className="px-1">
            <Sparkline data={series.rx} color={C.rx} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-emerald-400" /> Carga do sistema
            </CardTitle>
            <CardDescription>CPU e memória nos últimos {series.n} pontos · atualiza a cada 2s</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex items-center gap-4 text-xs">
              <Legend color={C.cpu} label="CPU" value={sys ? `${sys.cpuUsage.toFixed(1)}%` : '—'} />
              <Legend color={C.mem} label="Memória" value={`${memPct.toFixed(1)}%`} />
            </div>
            <AreaSeries
              height={170}
              max={100}
              series={[
                { name: 'CPU', color: C.cpu, data: series.cpu },
                { name: 'Mem', color: C.mem, data: series.mem },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="size-4 text-fuchsia-400" /> Tráfego de rede
            </CardTitle>
            <CardDescription>Download e upload agregados (exceto loopback)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex items-center gap-4 text-xs">
              <Legend color={C.rx} label="Download" value={formatRate(rates?.rx ?? 0)} />
              <Legend color={C.tx} label="Upload" value={formatRate(rates?.tx ?? 0)} />
              <span className="ml-auto text-muted-foreground">
                pico {formatBytes(Math.max(1, ...series.rx, ...series.tx), 1)}/s
              </span>
            </div>
            <AreaSeries
              height={170}
              series={[
                { name: 'rx', color: C.rx, data: series.rx },
                { name: 'tx', color: C.tx, data: series.tx },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <GaugeIcon className="size-4 text-amber-400" /> Interfaces
              </CardTitle>
              <Button variant="ghost" size="xs" onClick={() => setShowVirtual((v) => !v)}>
                {showVirtual ? 'ocultar virtuais' : 'mostrar virtuais'}
              </Button>
            </div>
            <CardDescription>{ifaces.filter((i) => !i.internal).length} ativas</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[250px]">
              <div className="space-y-1 px-4 pb-3">
                {ifaces.map((i) => {
                  const rate = net?.perIface?.[i.name]
                  return (
                    <div key={i.name} className="rounded-lg border bg-card/40 px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'size-2 rounded-full',
                            i.operstate === 'up' ? 'bg-emerald-400' : i.internal ? 'bg-muted-foreground' : 'bg-amber-400',
                          )}
                        />
                        <span className="font-mono text-xs font-semibold">{i.name}</span>
                        {i.speed && (
                          <Badge variant="outline" className="h-4 px-1 text-[9px]">
                            {i.speed >= 1000 ? `${i.speed / 1000}Gb` : `${i.speed}Mb`}
                          </Badge>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{i.ipv4 || 'sem IP'}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
                        <span className="text-sky-400">↓ {formatRate(rate?.rx ?? 0)}</span>
                        <span className="text-fuchsia-400">↑ {formatRate(rate?.tx ?? 0)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <TopProcesses
          title="Top CPU"
          icon={<Zap className="size-4 text-amber-400" />}
          procs={topCpu}
          get={(p) => `${p.cpu.toFixed(1)}%`}
          getValue={(p) => p.cpu}
          color="#f59e0b"
        />
        <TopProcesses
          title="Top memória"
          icon={<MemoryStick className="size-4 text-violet-400" />}
          procs={topMem}
          get={(p) => formatBytes(p.mem, 1)}
          getValue={(p) => p.mem}
          color={C.mem}
        />
      </div>

      {cpuHigh && (
        <div className="text-center text-xs text-muted-foreground">
          Pico de CPU em {sys?.cpuUsage.toFixed(0)}% — veja detalhes na aba Processos.
        </div>
      )}
    </div>
  )
}

function TopProcesses({
  title,
  icon,
  procs,
  get,
  getValue,
  color,
}: {
  title: string
  icon: React.ReactNode
  procs: ProcInfo[]
  get: (p: ProcInfo) => string
  getValue: (p: ProcInfo) => number
  color: string
}) {
  const max = Math.max(1, ...procs.map(getValue))
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {procs.length === 0 && <div className="text-sm text-muted-foreground">Carregando…</div>}
        {procs.map((p) => (
          <div key={p.pid} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-12 shrink-0 font-mono text-[10px] text-muted-foreground">{p.pid}</span>
              <span className="truncate font-medium">{p.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{p.user}</span>
              <div className="ml-auto hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted xl:block">
                <div className="h-full" style={{ width: `${(getValue(p) / max) * 100}%`, background: color }} />
              </div>
            </div>
            <span className="font-mono text-xs tabular-nums">{get(p)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
