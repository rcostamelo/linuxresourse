import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  Copy,
  File as FileIcon,
  Folder,
  HardDrive,
  Home,
  Link2,
  RefreshCw,
  Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { StatCard } from '@/components/StatCard'
import { formatBytes, formatPct } from '@/lib/format'
import type { DiskItem, FsInfo } from '@/lib/api'
import { cn } from '@/lib/utils'

function colorFor(name: string, isDir: boolean) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return isDir ? `hsl(${(h * 0.35 + 205) % 360} 58% 44%)` : `hsl(${(h * 0.45 + 30) % 360} 60% 47%)`
}

function squarify(items: DiskItem[], x: number, y: number, w: number, h: number) {
  const rects: { it: DiskItem; x: number; y: number; w: number; h: number }[] = []
  const total = items.reduce((s, i) => s + i.size, 0)
  if (total <= 0 || w <= 0 || h <= 0) return rects

  const scale = (w * h) / total
  const nodes = items
    .filter((i) => i.size > 0)
    .map((i) => ({ it: i, area: i.size * scale }))
    .sort((a, b) => b.area - a.area)

  const worst = (row: { area: number }[], side: number) => {
    const sum = row.reduce((s, n) => s + n.area, 0)
    if (sum === 0 || side === 0) return Infinity
    let max = -Infinity
    let min = Infinity
    for (const n of row) {
      if (n.area > max) max = n.area
      if (n.area < min) min = n.area
    }
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min))
  }

  let rx = x
  let ry = y
  let rw = w
  let rh = h
  let row: { it: DiskItem; area: number }[] = []

  const layoutRow = (r: { it: DiskItem; area: number }[]) => {
    const sum = r.reduce((s, n) => s + n.area, 0)
    if (rw >= rh) {
      const colW = sum / rh
      let cy = ry
      for (const n of r) {
        const cellH = n.area / colW
        rects.push({ it: n.it, x: rx, y: cy, w: colW, h: cellH })
        cy += cellH
      }
      rx += colW
      rw -= colW
    } else {
      const rowH = sum / rw
      let cx = rx
      for (const n of r) {
        const cellW = n.area / rowH
        rects.push({ it: n.it, x: cx, y: ry, w: cellW, h: rowH })
        cx += cellW
      }
      ry += rowH
      rh -= rowH
    }
  }

  let i = 0
  while (i < nodes.length) {
    const side = Math.min(rw, rh)
    if (row.length === 0) {
      row.push(nodes[i])
      i++
    } else if (worst([...row, nodes[i]], side) <= worst(row, side)) {
      row.push(nodes[i])
      i++
    } else {
      layoutRow(row)
      row = []
    }
  }
  if (row.length) layoutRow(row)
  return rects
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, size }
}

function Treemap({ items, onOpen }: { items: DiskItem[]; onOpen: (p: string) => void }) {
  const { ref, size } = useElementSize<HTMLDivElement>()
  const [hover, setHover] = useState<{ it: DiskItem; x: number; y: number } | null>(null)

  const rects = useMemo(() => {
    const top = [...items].sort((a, b) => b.size - a.size).slice(0, 150)
    return squarify(top, 0, 0, size.w, size.h)
  }, [items, size])

  return (
    <div ref={ref} className="relative h-[min(64vh,620px)] w-full overflow-hidden rounded-lg bg-muted/30">
      {rects.length === 0 ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">Sem dados.</div>
      ) : (
        <svg width={size.w} height={size.h} className="block">
          {rects.map((r, idx) => {
            const it = r.it
            const showLabel = r.w > 62 && r.h > 24
            const showSize = r.h > 42
            return (
              <g
                key={it.path + idx}
                onClick={() => it.isDir && onOpen(it.path)}
                onMouseEnter={(e) => setHover({ it, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ it, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                className={it.isDir ? 'cursor-pointer' : 'cursor-default'}
              >
                <rect
                  x={r.x + 0.5}
                  y={r.y + 0.5}
                  width={Math.max(0, r.w - 1)}
                  height={Math.max(0, r.h - 1)}
                  rx={3}
                  fill={colorFor(it.name, it.isDir)}
                  className="stroke-black/30 transition-[filter] hover:brightness-125"
                  strokeWidth={1}
                />
                {showLabel && (
                  <text x={r.x + 7} y={r.y + 17} className="pointer-events-none fill-white text-[11px] font-semibold">
                    {it.name.length > Math.floor(r.w / 7)
                      ? it.name.slice(0, Math.max(3, Math.floor(r.w / 7) - 1)) + '…'
                      : it.name}
                  </text>
                )}
                {showLabel && showSize && (
                  <text x={r.x + 7} y={r.y + 31} className="pointer-events-none fill-white/75 text-[10px]">
                    {formatBytes(it.size)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-[360px] rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-xl"
          style={{ left: Math.min(hover.x + 14, window.innerWidth - 370), top: hover.y + 14 }}
        >
          <div className="break-all font-mono">{hover.it.path}</div>
          <div className="mt-0.5 text-muted-foreground">
            {hover.it.isDir ? 'Diretório' : 'Arquivo'} · {formatBytes(hover.it.size)}
            {hover.it.isDir ? ' · clique para explorar' : ''}
            {hover.it.denied ? ' · sem permissão' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

export function DiskExplorer() {
  const [path, setPath] = useState('/')
  const [input, setInput] = useState('/')
  const [items, setItems] = useState<DiskItem[]>([])
  const [fs, setFs] = useState<FsInfo | null>(null)
  const [expected, setExpected] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const buf = useRef<DiskItem[]>([])
  const raf = useRef<number | undefined>(undefined)

  useEffect(() => {
    setItems([])
    setFs(null)
    setExpected(null)
    setLoading(true)
    setInput(path)
    buf.current = []

    const es = new EventSource('/api/scan?path=' + encodeURIComponent(path))
    es.addEventListener('meta', (e) => setFs(JSON.parse(e.data).fs))
    es.addEventListener('count', (e) => setExpected(JSON.parse(e.data).total))
    es.addEventListener('item', (e) => {
      buf.current.push(JSON.parse(e.data))
      if (raf.current === undefined) {
        raf.current = requestAnimationFrame(() => {
          raf.current = undefined
          const batch = buf.current
          buf.current = []
          if (batch.length) setItems((prev) => [...prev, ...batch])
        })
      }
    })
    es.addEventListener('done', () => {
      setLoading(false)
      es.close()
    })
    es.addEventListener('error', () => setLoading(false))
    return () => {
      es.close()
      if (raf.current !== undefined) cancelAnimationFrame(raf.current)
      raf.current = undefined
    }
  }, [path])

  const sorted = useMemo(() => [...items].sort((a, b) => b.size - a.size), [items])
  const total = useMemo(() => items.reduce((s, i) => s + i.size, 0), [items])

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = f ? sorted.filter((i) => i.name.toLowerCase().includes(f)) : sorted
    return list.slice(0, 400)
  }, [sorted, filter])

  const dirSize = useMemo(() => items.filter((i) => i.isDir).reduce((s, i) => s + i.size, 0), [items])
  const fileSize = total - dirSize
  const dirCount = items.filter((i) => i.isDir).length
  const fileCount = items.length - dirCount
  const maxSize = sorted[0]?.size || 1

  const crumbs = useMemo(() => {
    const segs = path.split('/').filter(Boolean)
    const acc: { label: string; target: string }[] = [{ label: '/', target: '/' }]
    let cur = ''
    for (const s of segs) {
      cur += '/' + s
      acc.push({ label: s, target: cur })
    }
    return acc
  }, [path])

  const copy = (p: string) => {
    navigator.clipboard?.writeText(p).then(() => {
      setCopied(p)
      setTimeout(() => setCopied(null), 900)
    })
  }

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const v = input.trim()
          if (v) setPath(v.startsWith('/') ? v : '/' + v)
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            className="pl-8 font-mono"
            placeholder="/caminho/para/escanear"
          />
        </div>
        <Button type="submit" variant="secondary">
          {loading ? <RefreshCw className="animate-spin" /> : <Search />}
          Escanear
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((c, i) => (
          <span key={c.target} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" />}
            <button
              onClick={() => i !== crumbs.length - 1 && setPath(c.target)}
              className={cn(
                'flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs',
                i === crumbs.length - 1
                  ? 'font-semibold text-foreground'
                  : 'text-primary hover:bg-muted',
              )}
            >
              {i === 0 ? <Home className="size-3.5" /> : null}
              {c.label}
            </button>
          </span>
        ))}
        {loading && expected !== null && (
          <Badge variant="secondary" className="ml-2 gap-1">
            <RefreshCw className="size-3 animate-spin" />
            {items.length}/{expected}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Tamanho da pasta"
          value={formatBytes(total)}
          hint={`${items.length}${expected !== null ? ' / ' + expected : ''} itens`}
          icon={<Folder className="size-4 text-sky-400" />}
        />
        <StatCard
          label="Partição"
          value={fs ? formatBytes(fs.used, 1) : '—'}
          hint={fs ? `${formatBytes(fs.free, 1)} livre de ${formatBytes(fs.total, 1)}` : ''}
          icon={<HardDrive className="size-4 text-violet-400" />}
        >
          {fs ? (
            <Progress value={(fs.used / fs.total) * 100} className="mt-2 h-1.5" />
          ) : null}
        </StatCard>
        <StatCard
          label="Diretórios"
          value={formatBytes(dirSize)}
          hint={`${dirCount} pastas neste nível`}
          icon={<Folder className="size-4 text-amber-400" />}
        />
        <StatCard
          label="Arquivos"
          value={formatBytes(fileSize)}
          hint={`${fileCount} arquivos neste nível`}
          icon={<FileIcon className="size-4 text-emerald-400" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Mapa de armazenamento</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <i className="size-2.5 rounded-[3px] bg-sky-400" /> Diretório
              </span>
              <span className="flex items-center gap-1">
                <i className="size-2.5 rounded-[3px] bg-amber-400" /> Arquivo
              </span>
            </div>
          </div>
          <Treemap items={items} onOpen={setPath} />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              Itens <span className="font-normal text-muted-foreground">({filtered.length})</span>
            </h3>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar..."
              className="h-7 w-40 text-xs"
            />
          </div>
          <div className="grid grid-cols-[1fr_84px_46px] gap-2 px-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <span>Nome</span>
            <span className="text-right">Tamanho</span>
            <span className="text-right">%</span>
          </div>
          <ScrollArea className="h-[min(64vh,620px)] rounded-lg border">
            {filtered.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                {loading ? 'Escaneando…' : 'Nada encontrado.'}
              </div>
            ) : (
              filtered.map((it) => (
                <div
                  key={it.path}
                  className="group relative grid grid-cols-[1fr_84px_46px] items-center gap-2 border-b border-border/50 px-2 py-1.5 last:border-0 hover:bg-muted/50"
                >
                  <button
                    onClick={() => it.isDir && setPath(it.path)}
                    className={cn(
                      'flex min-w-0 items-center gap-1.5 text-left font-mono text-xs',
                      it.isDir ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    {it.isDir ? (
                      <Folder className="size-3.5 shrink-0 text-sky-400" />
                    ) : it.isLink ? (
                      <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className={cn('truncate', it.isDir && 'text-primary')}>{it.name}</span>
                    {it.denied && (
                      <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                        sem permissão
                      </Badge>
                    )}
                  </button>
                  <span className="text-right text-xs font-semibold tabular-nums">{formatBytes(it.size)}</span>
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {formatPct(it.size, total)}
                  </span>
                  <span
                    className="absolute bottom-0 left-0 h-px bg-primary/70"
                    style={{ width: `${(it.size / maxSize) * 100}%` }}
                  />
                  <TooltipCopy onClick={() => copy(it.path)} copied={copied === it.path} />
                </div>
              ))
            )}
          </ScrollArea>
          <Separator className="my-2" />
          <p className="text-xs text-muted-foreground">
            Mostrando os {filtered.length} maiores. Clique numa pasta para descer; use o breadcrumb para subir.
          </p>
        </div>
      </div>
    </div>
  )
}

function TooltipCopy({ onClick, copied }: { onClick: () => void; copied: boolean }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="absolute top-1/2 right-1 -translate-y-1/2 rounded-md border bg-background p-1 opacity-0 transition-opacity group-hover:opacity-100"
      title="Copiar caminho"
    >
      {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3 text-muted-foreground" />}
    </button>
  )
}
