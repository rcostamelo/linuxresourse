import { useEffect, useState } from 'react'
import { Boxes, Container, Server, Terminal } from '@/components/ui/lucide-animated'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type TelemetryLoaderVariant = 'docker' | 'ssh' | 'ssh-detail'

interface VariantConfig {
  badge: string
  title: string
  subtitle: string
  accent: 'sky' | 'emerald' | 'cyan'
  steps: string[]
}

const CONFIGS: Record<TelemetryLoaderVariant, VariantConfig> = {
  docker: {
    badge: 'DOCKER ENGINE // TELEMETRIA',
    title: 'Sincronizando containers e estatísticas do Docker…',
    subtitle: 'O daemon consulta estado, uso de CPU/RAM em tempo real (docker stats), imagens e volumes.',
    accent: 'sky',
    steps: [
      'Conectando ao socket /var/run/docker.sock…',
      'Listando containers e verificando estado de execução…',
      'Coletando telemetria em tempo real (CPU, RAM, Net I/O, Block I/O)…',
      'Calculando imagens, volumes e espaço recuperável…',
    ],
  },
  ssh: {
    badge: 'SSH FLEET // TELEMETRIA REMOTA',
    title: 'Conectando aos servidores remotos via SSH…',
    subtitle: 'Validando chaves conhecidas (known_hosts) e coletando CPU, memória, disco e tráfego dos clusters.',
    accent: 'emerald',
    steps: [
      'Carregando inventário de clusters e credenciais criptografadas…',
      'Estabelecendo conexões SSH e verificando fingerprints SHA256…',
      'Lendo /proc/stat, /proc/meminfo, sistemas de arquivos e interfaces…',
      'Consolidando histórico de métricas e status dos servidores…',
    ],
  },
  'ssh-detail': {
    badge: 'SSH DEEP PROBE // INSPEÇÃO DO HOST',
    title: 'Coletando diagnóstico profundo do servidor…',
    subtitle: 'Inspecionando todos os pontos de montagem, interfaces de rede, processos e histórico.',
    accent: 'cyan',
    steps: [
      'Executando sonda detalhada via túnel SSH…',
      'Mapeando partições de disco, interfaces de rede e processos ativos…',
      'Carregando séries temporais do SQLite e trilha de auditoria…',
    ],
  },
}

export function TelemetryLoader({
  variant,
  className,
  labelOverride,
}: {
  variant: TelemetryLoaderVariant
  className?: string
  labelOverride?: string
}) {
  const cfg = CONFIGS[variant]
  const [stepIdx, setStepIdx] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    const stepTimer = window.setInterval(() => {
      setStepIdx((prev) => (prev + 1) % cfg.steps.length)
    }, 1100)
    const clockTimer = window.setInterval(() => {
      setElapsedMs((prev) => prev + 100)
    }, 100)
    return () => {
      window.clearInterval(stepTimer)
      window.clearInterval(clockTimer)
    }
  }, [cfg.steps.length])

  const palette =
    cfg.accent === 'sky'
      ? {
          ringOuter: 'border-sky-400/35 border-t-sky-400',
          ringInner: 'border-cyan-400/25 border-b-cyan-300',
          glow: 'bg-sky-500/20',
          coreBg: 'bg-sky-500/15 ring-sky-400/35 text-sky-300',
          badge: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
          dot: 'bg-sky-400 shadow-[0_0_8px_#38bdf8]',
          bar: 'from-sky-500 via-cyan-300 to-sky-500',
        }
      : cfg.accent === 'emerald'
        ? {
            ringOuter: 'border-emerald-400/35 border-t-emerald-400',
            ringInner: 'border-cyan-400/25 border-b-cyan-300',
            glow: 'bg-emerald-500/20',
            coreBg: 'bg-emerald-500/15 ring-emerald-400/35 text-emerald-300',
            badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
            dot: 'bg-emerald-400 shadow-[0_0_8px_#34d399]',
            bar: 'from-emerald-500 via-cyan-300 to-emerald-500',
          }
        : {
            ringOuter: 'border-cyan-400/35 border-t-cyan-400',
            ringInner: 'border-violet-400/25 border-b-violet-300',
            glow: 'bg-cyan-500/20',
            coreBg: 'bg-cyan-500/15 ring-cyan-400/35 text-cyan-300',
            badge: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
            dot: 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]',
            bar: 'from-cyan-500 via-violet-400 to-cyan-500',
          }

  return (
    <div className={cn('space-y-4', className)}>
      <Card className="relative overflow-hidden border-cyan-500/20 bg-card/80 px-6 py-10 backdrop-blur-xl">
        {/* Radial subtle background glow */}
        <div
          className={cn(
            'pointer-events-none absolute top-1/2 left-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl',
            palette.glow,
          )}
        />

        <div className="relative mx-auto flex max-w-xl flex-col items-center text-center">
          {/* Custom Multi-Ring Orbital Spinner */}
          <div className="relative mb-6 grid size-24 place-items-center">
            {/* Outer pulsing halo */}
            <div className={cn('absolute inset-0 animate-ping rounded-full opacity-20 [animation-duration:2.4s]', palette.glow)} />

            {/* Outer spinning orbital ring */}
            <div
              className={cn(
                'absolute inset-0 animate-spin rounded-full border-2 [animation-duration:2.2s]',
                palette.ringOuter,
              )}
            />

            {/* Middle dashed counter-rotating ring */}
            <div
              className={cn(
                'absolute inset-2.5 animate-spin rounded-full border-2 border-dashed [animation-direction:reverse] [animation-duration:3.4s]',
                palette.ringInner,
              )}
            />

            {/* Orbiting satellite dot */}
            <div className="absolute inset-0 animate-spin [animation-duration:2.2s]">
              <span className={cn('absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full', palette.dot)} />
            </div>

            {/* Inner Hexagon/Core Icon */}
            <div
              className={cn(
                'relative grid size-12 place-items-center rounded-2xl ring-1 backdrop-blur-md',
                palette.coreBg,
              )}
            >
              {variant === 'docker' ? (
                <Container className="size-6 animate-pulse" />
              ) : variant === 'ssh' ? (
                <Server className="size-6 animate-pulse" />
              ) : (
                <Terminal className="size-6 animate-pulse" />
              )}
            </div>
          </div>

          {/* Badge + Elapsed timer */}
          <div className="mb-2.5 flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium tracking-wider uppercase',
                palette.badge,
              )}
            >
              <span className={cn('size-1.5 animate-pulse rounded-full', palette.dot)} />
              {cfg.badge}
            </span>
            <span className="rounded-md border border-white/10 bg-black/30 px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>

          {/* Main title & subtitle */}
          <h3 className="text-base font-semibold tracking-tight text-foreground">
            {labelOverride || cfg.title}
          </h3>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            {cfg.subtitle}
          </p>

          {/* Animated step terminal box */}
          <div className="mt-5 flex w-full max-w-md items-center gap-2.5 rounded-lg border border-white/10 bg-black/45 px-3.5 py-2.5 text-left font-mono text-xs">
            <span className="text-cyan-400">$</span>
            <span className="truncate text-slate-200">{cfg.steps[stepIdx]}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              {cfg.steps.map((_, idx) => (
                <span
                  key={idx}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-300',
                    idx === stepIdx ? 'w-4 bg-cyan-400' : 'w-1.5 bg-white/15',
                  )}
                />
              ))}
            </span>
          </div>

          {/* Indeterminate scanning bar */}
          <div className="mt-3 h-1 w-full max-w-md overflow-hidden rounded-full bg-slate-900/90 ring-1 ring-white/5">
            <div
              className={cn(
                'h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r',
                palette.bar,
              )}
              style={{
                width: `${35 + ((stepIdx + 1) / cfg.steps.length) * 65}%`,
                transition: 'width 600ms ease-out',
              }}
            />
          </div>
        </div>
      </Card>

      {/* Contextual ghost preview skeletons so layout feels anchored */}
      {variant === 'docker' && (
        <Card className="overflow-hidden border-white/5 bg-card/40 p-4 opacity-60">
          <div className="mb-3 flex items-center gap-2">
            <Boxes className="size-4 text-emerald-400/50" />
            <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="grid grid-cols-6 items-center gap-3 rounded-lg border border-white/5 bg-muted/20 px-3 py-2.5"
              >
                <div className="col-span-2 space-y-1.5">
                  <div className="h-3 w-36 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-20 animate-pulse rounded bg-muted/70" />
                </div>
                <div className="h-5 w-16 animate-pulse rounded-full bg-emerald-500/10" />
                <div className="h-3 w-28 animate-pulse rounded bg-muted/80" />
                <div className="ml-auto h-3 w-14 animate-pulse rounded bg-muted/80" />
                <div className="ml-auto flex gap-1">
                  <div className="size-6 animate-pulse rounded bg-muted/70" />
                  <div className="size-6 animate-pulse rounded bg-muted/70" />
                  <div className="size-6 animate-pulse rounded bg-muted/70" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {variant === 'ssh' && (
        <div className="grid gap-3 opacity-60 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3 border-white/5 bg-card/40 p-4">
              <div className="flex items-center gap-2.5">
                <div className="size-9 animate-pulse rounded-lg bg-muted" />
                <div className="space-y-1.5">
                  <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-36 animate-pulse rounded bg-muted/70" />
                </div>
                <div className="ml-auto h-5 w-14 animate-pulse rounded-full bg-emerald-500/10" />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
                <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
                <div className="h-16 animate-pulse rounded-lg bg-muted/40" />
              </div>
              <div className="h-7 w-full animate-pulse rounded-lg bg-muted/30" />
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
