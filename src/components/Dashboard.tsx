import { useMemo, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Cpu,
  Gauge as GaugeIcon,
  Gpu,
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
import type { GpuDevice, ProcInfo } from '@/lib/api'
import { usePoll } from '@/lib/usePoll'
import { formatBytes, formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

const C = {
  cpu: '#10b981',
  mem: '#8b5cf6',
  gpu: '#06b6d4',
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
  const gpuInfo = metrics?.gpu ?? sys?.gpu
  const hasGpu = !!(gpuInfo?.available && gpuInfo.gpus.length > 0)
  const primaryGpu = hasGpu ? gpuInfo?.primary ?? gpuInfo?.gpus[0] ?? null : null

  const series = useMemo(() => {
    const p = history?.points ?? []
    const gpuPoints = p.map((x) => x.gpu ?? 0)
    const hasGpuSeries = p.some((x) => x.gpu != null)
    return {
      cpu: p.map((x) => x.cpu),
      mem: p.map((x) => x.mem),
      gpu: gpuPoints,
      hasGpuSeries,
      rx: p.map((x) => x.rx),
      tx: p.map((x) => x.tx),
      n: p.length,
    }
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
      <div className={cn('grid gap-3 sm:grid-cols-2', hasGpu ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
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
        {hasGpu && primaryGpu && (
          <GaugeCard
            title={gpuInfo && gpuInfo.count > 1 ? `GPUs (${gpuInfo.count})` : 'GPU'}
            icon={<Gpu className="size-3.5 text-cyan-400" />}
            value={primaryGpu.utilization ?? primaryGpu.memPct ?? 0}
            color={C.gpu}
            sub={
              primaryGpu.temperature != null
                ? `${primaryGpu.temperature}°C${primaryGpu.powerDraw != null ? ` · ${primaryGpu.powerDraw.toFixed(0)}W` : ''}`
                : primaryGpu.vendor
            }
            hint={
              primaryGpu.memTotal != null && primaryGpu.memUsed != null
                ? `VRAM ${formatBytes(primaryGpu.memUsed, 1)} / ${formatBytes(primaryGpu.memTotal, 1)}`
                : primaryGpu.name
            }
          />
        )}
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

      {hasGpu && gpuInfo && <GpuSection gpus={gpuInfo.gpus} />}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-emerald-400" /> Carga do sistema
            </CardTitle>
            <CardDescription>
              CPU{hasGpu ? ', GPU' : ''} e memória nos últimos {series.n} pontos · atualiza a cada 2s
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
              <Legend color={C.cpu} label="CPU" value={sys ? `${sys.cpuUsage.toFixed(1)}%` : '—'} />
              <Legend color={C.mem} label="Memória" value={`${memPct.toFixed(1)}%`} />
              {hasGpu && primaryGpu?.utilization != null && (
                <Legend color={C.gpu} label="GPU" value={`${primaryGpu.utilization.toFixed(0)}%`} />
              )}
            </div>
            <AreaSeries
              height={170}
              max={100}
              series={[
                { name: 'CPU', color: C.cpu, data: series.cpu },
                { name: 'Mem', color: C.mem, data: series.mem },
                ...(hasGpu && series.hasGpuSeries ? [{ name: 'GPU', color: C.gpu, data: series.gpu }] : []),
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

function GpuSection({ gpus }: { gpus: GpuDevice[] }) {
  return (
    <div className="space-y-3">
      {gpus.map((gpu) => {
        const utilPct = gpu.utilization ?? 0
        const vramPct = gpu.memPct ?? 0
        const powerPct =
          gpu.powerDraw != null && gpu.powerLimit != null && gpu.powerLimit > 0
            ? Math.min(100, (gpu.powerDraw / gpu.powerLimit) * 100)
            : null
        const temp = gpu.temperature
        const tempHot = temp != null && temp >= 80
        const tempWarn = temp != null && temp >= 68 && temp < 80

        const vendorColor =
          gpu.vendor === 'NVIDIA'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : gpu.vendor === 'AMD'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-300'

        return (
          <Card key={gpu.id} className="border-cyan-500/20">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="grid size-8 place-items-center rounded-lg bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-400/25">
                    <Gpu className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <span>{gpu.name}</span>
                      <Badge variant="outline" className={cn('font-mono text-[10px]', vendorColor)}>
                        {gpu.vendor}
                      </Badge>
                      {gpu.pstate && (
                        <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/10 font-mono text-[10px] text-cyan-300">
                          {gpu.pstate}
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="font-mono text-[11px]">
                      {[
                        gpu.driver ? `Driver ${gpu.driver}` : null,
                        gpu.busId ? `PCI ${gpu.busId}` : null,
                        gpu.clockCore ? `Core ${gpu.clockCore} MHz` : null,
                        gpu.clockMem ? `Mem ${gpu.clockMem} MHz` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Acelerador gráfico detectado no host'}
                    </CardDescription>
                  </div>
                </div>

                {temp != null && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'font-mono text-xs tabular-nums',
                      tempHot
                        ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                        : tempWarn
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
                    )}
                  >
                    {temp}°C {gpu.fanSpeed != null ? `· Fan ${gpu.fanSpeed}%` : ''}
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {/* Core Utilization */}
                <div className="rounded-lg border border-white/8 bg-card/50 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[11px] text-muted-foreground uppercase">Carga GPU</span>
                    <span className="font-mono font-semibold text-cyan-300 tabular-nums">
                      {gpu.utilization != null ? `${gpu.utilization.toFixed(0)}%` : 'N/D'}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-900/90 ring-1 ring-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, utilPct))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                    <span>Clock gráfico</span>
                    <span>{gpu.clockCore != null ? `${gpu.clockCore} MHz` : '—'}</span>
                  </div>
                </div>

                {/* VRAM Usage */}
                <div className="rounded-lg border border-white/8 bg-card/50 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[11px] text-muted-foreground uppercase">VRAM Dedicada</span>
                    <span className="font-mono font-semibold text-violet-300 tabular-nums">
                      {gpu.memPct != null ? `${gpu.memPct.toFixed(1)}%` : 'N/D'}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-900/90 ring-1 ring-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-400 transition-all duration-500"
                      style={{ width: `${Math.min(100, Math.max(0, vramPct))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                    <span>
                      {gpu.memUsed != null && gpu.memTotal != null
                        ? `${formatBytes(gpu.memUsed, 1)} / ${formatBytes(gpu.memTotal, 1)}`
                        : 'Memória de vídeo'}
                    </span>
                    <span>{gpu.memUtilization != null ? `Bus ${gpu.memUtilization}%` : gpu.clockMem ? `${gpu.clockMem} MHz` : ''}</span>
                  </div>
                </div>

                {/* Power Draw */}
                <div className="rounded-lg border border-white/8 bg-card/50 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[11px] text-muted-foreground uppercase">Energia (TDP)</span>
                    <span className="font-mono font-semibold text-amber-300 tabular-nums">
                      {gpu.powerDraw != null ? `${gpu.powerDraw.toFixed(1)} W` : 'N/D'}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-900/90 ring-1 ring-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-500"
                      style={{ width: `${powerPct ?? 0}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                    <span>Limite: {gpu.powerLimit != null ? `${gpu.powerLimit.toFixed(0)} W` : '—'}</span>
                    <span>{powerPct != null ? `${powerPct.toFixed(0)}% TDP` : ''}</span>
                  </div>
                </div>

                {/* Thermal & Fan */}
                <div className="rounded-lg border border-white/8 bg-card/50 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-[11px] text-muted-foreground uppercase">Térmico & Cooler</span>
                    <span
                      className={cn(
                        'font-mono font-semibold tabular-nums',
                        tempHot ? 'text-rose-400' : tempWarn ? 'text-amber-300' : 'text-emerald-300',
                      )}
                    >
                      {temp != null ? `${temp}°C` : 'N/D'}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-900/90 ring-1 ring-white/5">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all duration-500',
                        tempHot ? 'bg-rose-500' : tempWarn ? 'bg-amber-400' : 'bg-emerald-400',
                      )}
                      style={{ width: `${temp != null ? Math.min(100, Math.max(0, temp)) : 0}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                    <span>Ventoinha: {gpu.fanSpeed != null ? `${gpu.fanSpeed}%` : '—'}</span>
                    <span>{gpu.fanSpeed === 0 ? 'Zero RPM (Idle)' : tempHot ? 'Alta temp.' : 'Operação normal'}</span>
                  </div>
                </div>
              </div>

              {gpu.processes && gpu.processes.length > 0 && (
                <div className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                      Processos ativos na GPU ({gpu.processes.length})
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">VRAM alocada</span>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {gpu.processes.slice(0, 6).map((p) => (
                      <div
                        key={`${gpu.id}-${p.pid}`}
                        className="flex items-center justify-between gap-2 rounded border border-white/5 bg-card/60 px-2.5 py-1 text-xs"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="font-mono text-[10px] text-muted-foreground">{p.pid}</span>
                          {p.type && (
                            <span className="rounded bg-cyan-500/15 px-1 py-0.2 font-mono text-[9px] text-cyan-300">
                              {p.type}
                            </span>
                          )}
                          <span className="truncate font-medium">{p.name}</span>
                        </div>
                        <span className="shrink-0 font-mono text-[11px] text-violet-300 tabular-nums">
                          {p.memUsed > 0 ? formatBytes(p.memUsed, 0) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
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
          <div key={p.pid} className="grid grid-cols-[minmax(0,1fr)_auto_4.75rem] items-center gap-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-12 shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">{p.pid}</span>
              <span className="truncate font-medium">{p.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{p.user}</span>
            </div>
            <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(100, (getValue(p) / max) * 100)}%`, background: color }}
              />
            </div>
            <span className="text-right font-mono text-xs tabular-nums">{get(p)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
