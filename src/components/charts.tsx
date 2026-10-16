import { useId } from 'react'
import { cn } from '@/lib/utils'

function clamp(v: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v))
}

export function toneColor(v: number, invert = false) {
  const x = invert ? 100 - v : v
  if (x >= 85) return 'var(--destructive)'
  if (x >= 60) return '#f59e0b'
  return '#10b981'
}

export function Gauge({
  value,
  size = 132,
  thickness = 10,
  label,
  sub,
  color,
  unit = '%',
  decimals = 0,
}: {
  value: number
  size?: number
  thickness?: number
  label?: string
  sub?: string
  color?: string
  unit?: string
  decimals?: number
}) {
  const id = useId().replace(/:/g, '')
  const r = size / 2 - thickness
  const c = 2 * Math.PI * r
  const sweep = 0.75
  const pct = clamp(value / 100)
  const col = color ?? toneColor(value)

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-[135deg] overflow-visible">
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.65" />
            <stop offset="100%" stopColor={col} />
          </linearGradient>
          <filter id={`glow-${id}`} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          className="text-muted/45"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${c * sweep} ${c}`}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#g-${id})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${c * sweep * pct} ${c}`}
          filter={`url(#glow-${id})`}
          style={{ transition: 'stroke-dasharray .5s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
          {value.toFixed(decimals)}
          <span className="ml-0.5 text-sm text-muted-foreground">{unit}</span>
        </span>
        {label && <span className="font-mono text-xs font-medium text-muted-foreground">{label}</span>}
        {sub && <span className="text-[10px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  )
}

export interface Series {
  name: string
  color: string
  data: number[]
}

export function AreaSeries({
  series,
  height = 150,
  max,
  className,
  showGrid = true,
}: {
  series: Series[]
  height?: number
  max?: number
  className?: string
  showGrid?: boolean
}) {
  const id = useId().replace(/:/g, '')
  const n = Math.max(...series.map((s) => s.data.length), 0)
  const W = 1000
  const H = 300
  const peak = max ?? Math.max(1, ...series.flatMap((s) => s.data))

  const toPath = (data: number[]) => {
    if (data.length < 2) return { line: '', area: '' }
    const step = W / (data.length - 1)
    const line = data
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - clamp(v / peak) * H).toFixed(1)}`)
      .join(' ')
    return { line, area: `${line} L ${W},${H} L 0,${H} Z` }
  }

  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`a-${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.38" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {showGrid &&
          [0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={H * f}
              y2={H * f}
              stroke="currentColor"
              className="text-cyan-400/15"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              strokeDasharray="4 6"
            />
          ))}
        {series.map((s, i) => {
          const { line, area } = toPath(s.data)
          return (
            <g key={i}>
              {area && <path d={area} fill={`url(#a-${id}-${i})`} />}
              {line && (
                <path
                  d={line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  style={{ filter: `drop-shadow(0 0 6px ${s.color}66)` }}
                />
              )}
            </g>
          )
        })}
      </svg>
      {n === 0 && (
        <div className="-mt-[90px] text-center font-mono text-xs text-muted-foreground">coletando dados…</div>
      )}
    </div>
  )
}

export function Sparkline({ data, color, height = 34 }: { data: number[]; color: string; height?: number }) {
  const id = useId().replace(/:/g, '')
  const W = 200
  const H = 40
  const peak = Math.max(1, ...data)
  const pts = data.length
    ? data.map((v, i) => `${(i / Math.max(1, data.length - 1)) * W},${H - (v / peak) * H}`).join(' ')
    : ''
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`s-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.5" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts && <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#s-${id})`} />}
      {pts && (
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
        />
      )}
    </svg>
  )
}
