import { useMemo, useState } from 'react'
import {
  Activity,
  Cpu,
  Gauge,
  Gpu,
  Layers,
  MemoryStick,
  Server,
  Zap,
} from '@/components/ui/lucide-animated'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { StatCard } from '@/components/StatCard'
import { AreaSeries } from '@/components/charts'
import { api } from '@/lib/api'
import type { GpuDevice, ProcInfo } from '@/lib/api'
import { usePoll } from '@/lib/usePoll'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

const COLORS = {
  gpu: '#06b6d4',
  vram: '#8b5cf6',
  temp: '#10b981',
  power: '#f59e0b',
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

function SpecItem({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/8 bg-card/50 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 truncate text-xs font-medium text-foreground', mono && 'font-mono tabular-nums')}>
        {value}
      </div>
    </div>
  )
}

function ClockRow({
  label,
  current,
  max,
  color = 'from-cyan-500 to-emerald-400',
}: {
  label: string
  current: number | null | undefined
  max?: number | null | undefined
  color?: string
}) {
  const pct = current != null && max != null && max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : current != null ? 65 : 0
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">
          {current != null ? (
            <>
              <span className="font-semibold text-foreground">{current} MHz</span>
              {max != null ? <span className="text-muted-foreground"> / {max} MHz</span> : null}
            </>
          ) : (
            <span className="text-muted-foreground">N/D</span>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900/90 ring-1 ring-white/5">
        <div
          className={cn('h-full rounded-full bg-gradient-to-r transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function GpuPanel() {
  const { data: gpuData, error } = usePoll(api.gpu, 2000)
  const { data: history } = usePoll(api.history, 2000)
  const { data: procsData } = usePoll(api.processes, 2000)
  const [selectedIdx, setSelectedIdx] = useState(0)

  const gpus = gpuData?.gpus ?? []
  const activeGpu: GpuDevice | null = gpus[selectedIdx] ?? gpus[0] ?? null

  const procByPid = useMemo(() => {
    const map = new Map<number, ProcInfo>()
    for (const p of procsData?.processes ?? []) {
      map.set(p.pid, p)
    }
    return map
  }, [procsData])

  const series = useMemo(() => {
    const pts = history?.points ?? []
    return {
      gpu: pts.map((x) => x.gpu ?? 0),
      vram: pts.map((x) => x.gpuMem ?? 0),
      temp: pts.map((x) => x.gpuTemp ?? 0),
      power: pts.map((x) => x.gpuPower ?? 0),
      n: pts.length,
    }
  }, [history])

  if (!gpuData) {
    return (
      <div className="grid h-40 place-items-center text-sm text-muted-foreground">
        {error ? <span className="text-destructive">API offline: {error}</span> : 'Carregando telemetria de GPU…'}
      </div>
    )
  }

  if (!gpuData.available || !activeGpu) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gpu className="size-4 text-cyan-400" /> Placa de Vídeo (GPU)
          </CardTitle>
          <CardDescription>Nenhum acelerador gráfico dedicado ou integrado foi detectado neste host.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const utilPct = activeGpu.utilization ?? 0
  const vramPct = activeGpu.memPct ?? 0
  const memTotal = activeGpu.memTotal ?? 0
  const memUsed = activeGpu.memUsed ?? 0
  const memReserved = activeGpu.memReserved ?? 0
  const memFree = activeGpu.memFree ?? Math.max(0, memTotal - memUsed - memReserved)

  const powerDraw = activeGpu.powerDraw
  const powerLimit = activeGpu.powerLimit
  const powerPct =
    powerDraw != null && powerLimit != null && powerLimit > 0
      ? Math.min(100, Math.max(0, (powerDraw / powerLimit) * 100))
      : 0

  const temp = activeGpu.temperature
  const tempHot = temp != null && temp >= 80
  const tempWarn = temp != null && temp >= 68 && temp < 80

  const vendorColor =
    activeGpu.vendor === 'NVIDIA'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : activeGpu.vendor === 'AMD'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
        : 'border-sky-500/30 bg-sky-500/10 text-sky-300'

  const vramBreakdown =
    memTotal > 0
      ? [
          { label: 'Em uso (VRAM)', value: memUsed, color: 'bg-violet-500' },
          ...(memReserved > 0 ? [{ label: 'Reservada (Driver)', value: memReserved, color: 'bg-amber-400' }] : []),
          { label: 'Livre', value: memFree, color: 'bg-emerald-400/80' },
        ]
      : []

  const connectors = activeGpu.connectors ?? []
  const connectedDisplays = connectors.filter((c) => c.connected)
  const gpuProcs = activeGpu.processes ?? []
  const maxProcVram = Math.max(1, ...gpuProcs.map((p) => p.memUsed || 0))

  return (
    <div className="space-y-4">
      {/* Seletor de múltiplas GPUs (se houver mais de 1) */}
      {gpus.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {gpus.map((g, idx) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors',
                idx === selectedIdx
                  ? 'border-cyan-400/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-white/10 bg-card/60 text-muted-foreground hover:border-cyan-500/30 hover:text-foreground',
              )}
            >
              <Gpu className="size-3.5 text-cyan-400" />
              <span>GPU #{g.index}: {g.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Cabeçalho Técnico da Placa de Vídeo */}
      <Card className="border-cyan-500/20">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-400/30 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
                <Gpu className="size-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-lg">{activeGpu.name}</CardTitle>
                  <Badge variant="outline" className={cn('font-mono text-[10px]', vendorColor)}>
                    {activeGpu.vendor}
                  </Badge>
                  {activeGpu.pstate && (
                    <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 font-mono text-[10px] text-cyan-300">
                      Estado {activeGpu.pstate}
                    </Badge>
                  )}
                  {activeGpu.displayActive != null && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'font-mono text-[10px]',
                        activeGpu.displayActive
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-white/15 bg-white/5 text-muted-foreground',
                      )}
                    >
                      {activeGpu.displayActive ? 'Display Ativo' : 'Headless'}
                    </Badge>
                  )}
                </div>
                <CardDescription className="mt-0.5 font-mono text-xs">
                  UUID: {activeGpu.id}
                </CardDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              {activeGpu.pcieGen != null && (
                <Badge variant="outline" className="border-white/15 bg-black/30 font-mono text-[11px]">
                  PCIe Gen {activeGpu.pcieGen}
                  {activeGpu.pcieGenMax != null ? `/${activeGpu.pcieGenMax}` : ''} · x{activeGpu.pcieWidth ?? '?'}
                  {activeGpu.pcieWidthMax != null ? ` (máx x${activeGpu.pcieWidthMax})` : ''}
                </Badge>
              )}
              {activeGpu.driver && (
                <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/10 font-mono text-[11px] text-cyan-300">
                  Driver {activeGpu.driver}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            <SpecItem label="Barramento PCI" value={activeGpu.busId ? `0000:${activeGpu.busId}` : 'N/D'} />
            <SpecItem label="Versão do Driver" value={activeGpu.driver || 'N/D'} />
            <SpecItem label="BIOS de Vídeo (VBIOS)" value={activeGpu.vbios || 'N/D'} />
            <SpecItem
              label="Link PCIe (Atual / Máx)"
              value={
                activeGpu.pcieGen != null
                  ? `Gen ${activeGpu.pcieGen} x${activeGpu.pcieWidth ?? '?'} / Gen ${activeGpu.pcieGenMax ?? activeGpu.pcieGen} x${activeGpu.pcieWidthMax ?? '?'}`
                  : 'N/D'
              }
            />
            <SpecItem
              label="Modo Persistência"
              value={activeGpu.persistenceMode == null ? 'N/D' : activeGpu.persistenceMode ? 'Ativado' : 'Desativado'}
            />
            <SpecItem
              label="Saídas Conectadas"
              value={
                connectors.length > 0
                  ? `${connectedDisplays.length} de ${connectors.length} portas`
                  : activeGpu.displayActive
                    ? 'Ativa'
                    : 'N/D'
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* 4 Cards Principais de Telemetria */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Carga do Núcleo (GPU)"
          value={activeGpu.utilization != null ? `${activeGpu.utilization.toFixed(0)}%` : 'N/D'}
          hint={
            activeGpu.clockCore != null
              ? `Clock ${activeGpu.clockCore} MHz${activeGpu.clockCoreMax ? ` / ${activeGpu.clockCoreMax} MHz` : ''}`
              : 'Utilização do motor 3D/Compute'
          }
          icon={<Gpu className="size-4 text-cyan-400" />}
        />
        <StatCard
          label="VRAM em uso"
          value={memTotal > 0 ? formatBytes(memUsed, 1) : 'N/D'}
          hint={
            memTotal > 0
              ? `${vramPct.toFixed(1)}% de ${formatBytes(memTotal, 1)}${activeGpu.memUtilization != null ? ` · Bus ${activeGpu.memUtilization}%` : ''}`
              : 'Memória dedicada de vídeo'
          }
          icon={<MemoryStick className="size-4 text-violet-400" />}
        />
        <StatCard
          label="Temperatura & Cooler"
          value={temp != null ? `${temp}°C` : 'N/D'}
          hint={
            activeGpu.fanSpeed != null
              ? `Ventoinha em ${activeGpu.fanSpeed}%${activeGpu.fanSpeed === 0 ? ' (Zero RPM)' : ''}`
              : 'Sensor térmico do die'
          }
          icon={
            <Gauge
              className={cn(
                'size-4',
                tempHot ? 'text-rose-400' : tempWarn ? 'text-amber-400' : 'text-emerald-400',
              )}
            />
          }
        />
        <StatCard
          label="Consumo de Energia (TDP)"
          value={powerDraw != null ? `${powerDraw.toFixed(1)} W` : 'N/D'}
          hint={
            powerLimit != null
              ? `${powerPct.toFixed(0)}% do limite de ${powerLimit.toFixed(0)} W`
              : 'Leitura de potência da placa'
          }
          icon={<Zap className="size-4 text-amber-400" />}
        />
      </div>

      {/* Gráficos Históricos em Tempo Real */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-cyan-400" /> Histórico de Carga & VRAM
            </CardTitle>
            <CardDescription>
              Utilização do núcleo gráfico e alocação de VRAM nos últimos {series.n} pontos (2s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
              <Legend color={COLORS.gpu} label="Carga GPU" value={`${utilPct.toFixed(0)}%`} />
              <Legend color={COLORS.vram} label="VRAM" value={`${vramPct.toFixed(1)}%`} />
              {activeGpu.memUtilization != null && (
                <span className="ml-auto font-mono text-muted-foreground">
                  Controladora Mem: {activeGpu.memUtilization}%
                </span>
              )}
            </div>
            <AreaSeries
              height={175}
              max={100}
              series={[
                { name: 'GPU', color: COLORS.gpu, data: series.gpu },
                { name: 'VRAM', color: COLORS.vram, data: series.vram },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="size-4 text-amber-400" /> Histórico Térmico & Energia
            </CardTitle>
            <CardDescription>
              Temperatura do chip (°C) e potência consumida (W) nos últimos {series.n} pontos
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
              <Legend color={COLORS.temp} label="Temperatura" value={temp != null ? `${temp}°C` : '—'} />
              <Legend color={COLORS.power} label="Potência" value={powerDraw != null ? `${powerDraw.toFixed(1)} W` : '—'} />
              {powerLimit != null && (
                <span className="ml-auto font-mono text-muted-foreground">
                  TDP Máx: {powerLimit.toFixed(0)} W
                </span>
              )}
            </div>
            <AreaSeries
              height={175}
              max={Math.max(100, powerLimit ?? 100, ...series.temp, ...series.power)}
              series={[
                { name: 'Temp', color: COLORS.temp, data: series.temp },
                { name: 'Watts', color: COLORS.power, data: series.power },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Detalhamento de VRAM + Clocks & Conectores */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MemoryStick className="size-4 text-violet-400" /> Composição da Memória de Vídeo (VRAM)
            </CardTitle>
            <CardDescription>
              {memTotal > 0
                ? `${formatBytes(memUsed, 1)} usados de ${formatBytes(memTotal, 1)} · ${vramPct.toFixed(1)}%`
                : 'Alocação de memória dedicada da placa de vídeo'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={vramPct} className="h-3" />

            {vramBreakdown.length > 0 && (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
                  {vramBreakdown.map((b) => (
                    <div
                      key={b.label}
                      className={b.color}
                      style={{ width: `${(b.value / memTotal) * 100}%` }}
                      title={`${b.label}: ${formatBytes(b.value, 1)}`}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {vramBreakdown.map((b) => (
                    <div key={b.label} className="flex items-center gap-2 rounded-lg border border-white/8 bg-card/40 px-2.5 py-2 text-xs">
                      <i className={cn('size-2.5 shrink-0 rounded-full', b.color)} />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] text-muted-foreground">{b.label}</div>
                        <div className="font-mono font-semibold tabular-nums">{formatBytes(b.value, 1)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SpecItem label="Total Dedicado" value={memTotal > 0 ? formatBytes(memTotal, 1) : 'N/D'} />
              <SpecItem label="Em Uso (Apps)" value={memTotal > 0 ? formatBytes(memUsed, 1) : 'N/D'} />
              <SpecItem label="Livre Disponível" value={memTotal > 0 ? formatBytes(memFree, 1) : 'N/D'} />
              <SpecItem
                label="Uso do Barramento"
                value={activeGpu.memUtilization != null ? `${activeGpu.memUtilization}%` : 'N/D'}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="size-4 text-cyan-400" /> Frequências (Clocks) & Saídas de Vídeo
            </CardTitle>
            <CardDescription>
              Operação em tempo real dos domínios de clock e portas DRM conectadas
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <ClockRow
                label="Clock Gráfico (Core)"
                current={activeGpu.clockCore}
                max={activeGpu.clockCoreMax}
                color="from-cyan-500 to-emerald-400"
              />
              {activeGpu.clockSm != null && (
                <ClockRow
                  label="Clock SM (Streaming Multiprocessor)"
                  current={activeGpu.clockSm}
                  max={activeGpu.clockCoreMax}
                  color="from-sky-500 to-cyan-400"
                />
              )}
              <ClockRow
                label="Clock de Memória (VRAM)"
                current={activeGpu.clockMem}
                max={activeGpu.clockMemMax}
                color="from-violet-500 to-fuchsia-400"
              />
              {activeGpu.clockVideo != null && (
                <ClockRow
                  label="Clock de Vídeo (NVENC / NVDEC)"
                  current={activeGpu.clockVideo}
                  max={activeGpu.clockCoreMax}
                  color="from-amber-500 to-orange-400"
                />
              )}
            </div>

            {connectors.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-mono text-[11px] text-muted-foreground uppercase">
                      Conectores Físicos DRM ({connectedDisplays.length} ativos)
                    </span>
                    {activeGpu.encoderFps != null && activeGpu.encoderFps > 0 && (
                      <span className="font-mono text-[11px] text-amber-300">Encoder: {activeGpu.encoderFps} FPS</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {connectors.map((c) => (
                      <div
                        key={c.name}
                        className={cn(
                          'rounded-lg border px-2.5 py-2 font-mono text-xs',
                          c.connected
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                            : 'border-white/8 bg-card/40 text-muted-foreground',
                        )}
                      >
                        <div className="flex items-center gap-1.5 font-semibold">
                          <span
                            className={cn(
                              'size-2 rounded-full',
                              c.connected ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-muted-foreground/50',
                            )}
                          />
                          <span>{c.name}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] opacity-85">
                          {c.connected ? c.mode || 'Conectado' : 'Desconectado'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Processos Ativos na GPU */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4 text-cyan-400" /> Processos utilizando a GPU ({gpuProcs.length})
              </CardTitle>
              <CardDescription>
                Aplicações com contextos gráficos (G - Vulkan/OpenGL/X11/Wayland) ou computacionais (C - CUDA/OpenCL) abertos
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/10 font-mono text-[10px] text-cyan-300">
                G = Gráfico
              </Badge>
              <Badge variant="outline" className="border-violet-500/25 bg-violet-500/10 font-mono text-[10px] text-violet-300">
                C = Compute
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {gpuProcs.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Server className="size-4 text-muted-foreground" /> Nenhum processo mantendo contexto ativo na GPU neste instante.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-[4.5rem_3.5rem_minmax(0,1fr)_5.5rem_4.5rem_4.5rem_4.5rem_8rem_5.5rem] items-center gap-3 border-b border-white/10 pb-2 font-mono text-[10px] text-muted-foreground uppercase lg:grid">
                <span>PID</span>
                <span>Tipo</span>
                <span>Processo / Comando</span>
                <span>Usuário</span>
                <span className="text-right">GPU SM</span>
                <span className="text-right">CPU</span>
                <span className="text-right">RAM Host</span>
                <span>Proporção VRAM</span>
                <span className="text-right">VRAM</span>
              </div>

              {gpuProcs.map((gp) => {
                const sysProc = procByPid.get(gp.pid)
                const vramRatio = memTotal > 0 ? (gp.memUsed / memTotal) * 100 : (gp.memUsed / maxProcVram) * 100
                const barWidth = Math.min(100, Math.max(2, (gp.memUsed / maxProcVram) * 100))

                return (
                  <div
                    key={`${activeGpu.id}-${gp.pid}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto_5.5rem] items-center gap-3 rounded-lg border border-white/6 bg-card/40 px-3 py-2 text-sm lg:grid-cols-[4.5rem_3.5rem_minmax(0,1fr)_5.5rem_4.5rem_4.5rem_4.5rem_8rem_5.5rem]"
                  >
                    <Badge variant="outline" className="hidden h-5 w-fit font-mono text-[10px] tabular-nums lg:inline-flex">
                      {gp.pid}
                    </Badge>

                    <Badge
                      variant="outline"
                      className={cn(
                        'hidden h-5 w-fit font-mono text-[10px] lg:inline-flex',
                        gp.type?.includes('C')
                          ? 'border-violet-500/30 bg-violet-500/15 text-violet-300'
                          : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
                      )}
                    >
                      {gp.type || 'G'}
                    </Badge>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-muted-foreground lg:hidden">#{gp.pid}</span>
                        <span className="truncate font-medium text-foreground">{sysProc?.name || gp.name}</span>
                      </div>
                      {sysProc?.cmdline && sysProc.cmdline !== sysProc.name && (
                        <div className="truncate font-mono text-[11px] text-muted-foreground">
                          {sysProc.cmdline}
                        </div>
                      )}
                    </div>

                    <span className="hidden truncate font-mono text-xs text-muted-foreground lg:block">
                      {sysProc?.user || '—'}
                    </span>

                    <span className="hidden text-right font-mono text-xs text-cyan-300 tabular-nums lg:block">
                      {gp.smUtil != null ? `${gp.smUtil}%` : '—'}
                    </span>

                    <span className="hidden text-right font-mono text-xs tabular-nums lg:block">
                      {sysProc ? `${sysProc.cpu.toFixed(1)}%` : '—'}
                    </span>

                    <span className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums lg:block">
                      {sysProc ? formatBytes(sysProc.mem, 1) : '—'}
                    </span>

                    <div className="hidden h-1.5 w-full overflow-hidden rounded-full bg-muted sm:block">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                        style={{ width: `${barWidth}%` }}
                        title={`${vramRatio.toFixed(1)}% da VRAM`}
                      />
                    </div>

                    <span className="text-right font-mono text-xs font-semibold text-violet-300 tabular-nums">
                      {gp.memUsed > 0 ? formatBytes(gp.memUsed, 1) : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
