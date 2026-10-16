export function formatBytes(n?: number | null, digits?: number): string {
  if (n === null || n === undefined || Number.isNaN(n) || !Number.isFinite(n)) return '—'
  const safe = Math.max(0, n)
  if (safe < 1024) return `${Math.round(safe)} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let v = safe / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const d = Math.max(0, Math.min(2, digits ?? (v >= 100 ? 0 : v >= 10 ? 1 : 2)))
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })} ${units[i]}`
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export function formatPct(part: number, whole: number, digits = 1): string {
  if (!whole || !Number.isFinite(part) || !Number.isFinite(whole)) return '0%'
  const p = (part / whole) * 100
  return `${p.toFixed(p >= 10 ? 0 : digits)}%`
}

export function basename(p: string): string {
  if (p === '/') return '/'
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || '/'
}

export function relTime(ts: number): string {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 2) return 'agora'
  if (s < 60) return `${s}s atrás`
  return `${Math.floor(s / 60)}m atrás`
}
