import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Cpu, MemoryStick, Activity, Skull, Search, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { StatCard } from '@/components/StatCard'
import { api, type ProcInfo } from '@/lib/api'
import { usePoll } from '@/lib/usePoll'
import { formatBytes, formatDuration } from '@/lib/format'
import { cn } from 'cn'

type SortKey = 'cpu' | 'mem' | 'pid' | 'name' | 'elapsedSec'

const STATE: Record<string, { label: string; className: string }> = {
  R: { label: 'executando', className: 'text-emerald-400 border-emerald-400/40' },
  S: { label: 'dormindo', className: 'text-sky-400 border-sky-400/40' },
  D: { label: 'disco', className: 'text-amber-400 border-amber-400/40' },
  Z: { label: 'zumbi', className: 'text-rose-400 border-rose-400/40' },
  T: { label: 'parado', className: 'text-violet-400 border-violet-400/40' },
  I: { label: 'idle', className: 'text-muted-foreground' },
}

function StateBadge({ state }: { state: string }) {
  const s = STATE[state] ?? { label: state, className: 'text-muted-foreground' }
  return (
    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', s.className)}>
      {s.label}
    </Badge>
  )
}

export function ProcessManager() {
  const { data, error } = usePoll(api.processes, 2000)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('cpu')
  const [dir, setDir] = useState<'asc' | 'desc'>('desc')
  const [killTarget, setKillTarget] = useState<ProcInfo | null>(null)
  const [busy, setBusy] = useState(false)

  const procs = data?.processes ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? procs.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.user.toLowerCase().includes(q) ||
            p.cmdline.toLowerCase().includes(q) ||
            String(p.pid) === q,
        )
      : procs
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv)
      return (av as number) - (bv as number)
    })
    if (dir === 'desc') sorted.reverse()
    return sorted
  }, [procs, query, sortKey, dir])

  const topCpu = useMemo(() => [...procs].sort((a, b) => b.cpu - a.cpu)[0], [procs])
  const topMem = useMemo(() => [...procs].sort((a, b) => b.mem - a.mem)[0], [procs])
  const memTotal = useMemo(() => procs.reduce((s, p) => s + p.mem, 0), [procs])

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else {
      setSortKey(k)
      setDir(k === 'name' ? 'asc' : 'desc')
    }
  }

  const SortHead = ({
    k,
    children,
    className,
  }: {
    k: SortKey
    children: React.ReactNode
    className?: string
  }) => (
    <TableHead className={className}>
      <button
        onClick={() => toggleSort(k)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground',
          sortKey === k && 'text-foreground',
        )}
      >
        {children}
        {sortKey === k && (dir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </TableHead>
  )

  const doKill = async () => {
    if (!killTarget) return
    setBusy(true)
    try {
      const r = await api.kill(killTarget.pid, 'TERM')
      toast.success(`SIGTERM enviado`, { description: `${killTarget.name} (pid ${r.pid})` })
      setKillTarget(null)
    } catch (e) {
      toast.error('Falha ao encerrar processo', { description: String((e as Error).message) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Processos"
          value={procs.length}
          hint={`${formatBytes(memTotal, 1)} em RSS`}
          icon={<Activity className="size-4 text-sky-400" />}
        />
        <StatCard
          label="CPU total"
          value={`${(data?.cpuUsage ?? 0).toFixed(1)}%`}
          hint={`load ${(data?.loadavg ?? [0, 0, 0]).map((l) => l.toFixed(2)).join(' · ')}`}
          icon={<Cpu className="size-4 text-violet-400" />}
        >
          <Progress value={data?.cpuUsage ?? 0} className="mt-2 h-1.5" />
        </StatCard>
        <StatCard
          label="Maior CPU"
          value={topCpu ? `${topCpu.cpu.toFixed(1)}%` : '—'}
          hint={topCpu ? `${topCpu.name} (pid ${topCpu.pid})` : ''}
          icon={<Cpu className="size-4 text-emerald-400" />}
        />
        <StatCard
          label="Maior memória"
          value={topMem ? formatBytes(topMem.mem, 1) : '—'}
          hint={topMem ? `${topMem.name} (pid ${topMem.pid})` : ''}
          icon={<MemoryStick className="size-4 text-amber-400" />}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar por nome, usuário, PID ou comando…"
            className="pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {error ? <span className="text-destructive">API offline: {error}</span> : `atualiza a cada 2s`}
        </span>
      </div>

      <ScrollArea className="h-[min(66vh,640px)] rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="hover:bg-transparent">
              <SortHead k="pid" className="w-20">
                PID
              </SortHead>
              <SortHead k="name">Processo</SortHead>
              <TableHead className="w-28">Usuário</TableHead>
              <SortHead k="cpu" className="w-24 text-right">
                CPU
              </SortHead>
              <SortHead k="mem" className="w-28 text-right">
                Memória
              </SortHead>
              <TableHead className="w-14 text-right">Thr</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <SortHead k="elapsedSec" className="w-20 text-right">
                Uptime
              </SortHead>
              <TableHead className="w-14" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                  {procs.length === 0 ? 'Carregando processos…' : 'Nada encontrado.'}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((p) => (
                <TableRow key={p.pid} className="group">
                  <TableCell className="font-mono text-xs text-muted-foreground">{p.pid}</TableCell>
                  <TableCell className="max-w-[420px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {p.cmdline !== p.name ? p.cmdline : ''}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.user}</TableCell>
                  <TableCell className="text-right">
                    <span
                      className={cn(
                        'font-mono text-xs tabular-nums',
                        p.cpu > 50 ? 'text-rose-400' : p.cpu > 10 ? 'text-amber-400' : 'text-muted-foreground',
                      )}
                    >
                      {p.cpu.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="font-mono text-xs tabular-nums">{formatBytes(p.mem, 1)}</span>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{p.threads}</TableCell>
                  <TableCell>
                    <StateBadge state={p.state} />
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                    {formatDuration(p.elapsedSec)}
                  </TableCell>
                  <TableCell className="text-right">
                    {p.pid > 1 && (
                      <Button
                        variant="destructive"
                        size="icon-xs"
                        className="opacity-0 group-hover:opacity-100"
                        title="Encerrar processo"
                        onClick={() => setKillTarget(p)}
                      >
                        <Skull />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </ScrollArea>

      <AlertDialog open={!!killTarget} onOpenChange={(o) => !o && setKillTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-destructive" />
              Encerrar processo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Isso enviará <b>SIGTERM</b> para{' '}
              <span className="font-mono text-foreground">
                {killTarget?.name} (pid {killTarget?.pid})
              </span>
              . O processo pode ser finalizado imediatamente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                doKill()
              }}
              disabled={busy}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy ? 'Enviando…' : 'Encerrar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
