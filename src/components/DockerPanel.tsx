import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Container as ContainerIcon,
  Database,
  Image as ImageIcon,
  Loader2,
  Package,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  ScrollText,
  Search,
  Skull,
  Square,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import type { Container, DockerOverview } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { cn } from 'cn'

type Pending = { container: Container; action: string } | null

const stateStyle: Record<string, string> = {
  running: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  exited: 'bg-muted text-muted-foreground border-border',
  created: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  paused: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  restarting: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  dead: 'bg-destructive/15 text-destructive border-destructive/30',
}

function portList(ports: string) {
  if (!ports) return []
  const seen = new Map<string, string>()
  for (const part of ports.split(',')) {
    const p = part.trim()
    if (!p) continue
    const m = p.match(/(\d+)->(\d+)\/(\w+)/)
    if (m) {
      const key = `${m[1]}→${m[2]}/${m[3]}`
      seen.set(key, key)
      continue
    }
    const e = p.match(/^(\d+)\/(\w+)/)
    if (e) seen.set(`${e[1]}/${e[2]}`, `${e[1]}/${e[2]}`)
  }
  return [...seen.values()]
}

export function DockerPanel() {
  const [data, setData] = useState<DockerOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [q, setQ] = useState('')
  const [showImages, setShowImages] = useState(false)

  const [logTarget, setLogTarget] = useState<Container | null>(null)
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [follow, setFollow] = useState(false)
  const [tail, setTail] = useState(200)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setData(await api.dockerOverview())
      setError(null)
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = window.setInterval(() => load(true), 5000)
    return () => window.clearInterval(t)
  }, [load])

  const loadLogs = useCallback(
    async (c: Container, n: number, silent = false) => {
      if (!silent) setLogsLoading(true)
      try {
        const r = await api.dockerLogs(c.id, n)
        setLogs(r.ok ? r.logs || '(sem saída)' : `erro: ${r.error}`)
      } catch (e) {
        setLogs(`erro: ${String((e as Error).message || e)}`)
      } finally {
        setLogsLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!logTarget || !follow) return
    const t = window.setInterval(() => loadLogs(logTarget, tail, true), 3000)
    return () => window.clearInterval(t)
  }, [logTarget, follow, tail, loadLogs])

  const act = useCallback(
    async (c: Container, action: string) => {
      setBusy(c.id + action)
      try {
        await api.dockerAction(c.id, action)
        toast.success(`${label(action)} · ${c.name}`)
        await load(true)
        if (logTarget?.id === c.id && (action === 'start' || action === 'restart')) loadLogs(c, tail, true)
      } catch (e) {
        toast.error(String((e as Error).message || e))
      } finally {
        setBusy(null)
      }
    },
    [load, loadLogs, logTarget, tail],
  )

  const containers = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = data?.containers ?? []
    if (!s) return list
    return list.filter((c) =>
      [c.name, c.image, c.project, c.service, c.state, c.ports].join(' ').toLowerCase().includes(s),
    )
  }, [data, q])

  if (error && !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ContainerIcon className="size-4 text-sky-400" /> Docker indisponível
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const counts = data?.counts ?? {}
  const dfTotal = (data?.df ?? []).reduce((acc, r) => acc + (parseDockerSize(r.Reclaimable) || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          <ContainerIcon className="size-4 text-sky-400" /> Docker
          {data?.version && (
            <Badge variant="outline" className="font-mono text-[10px]">
              v{data.version}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
            {counts.running || 0} em execução
          </Badge>
          {!!counts.exited && <Badge variant="secondary">{counts.exited} parados</Badge>}
          {!!counts.created && <Badge variant="outline">{counts.created} criados</Badge>}
          {!!counts.paused && <Badge variant="outline">{counts.paused} pausados</Badge>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filtrar containers…"
              className="h-8 w-48 pl-7 text-xs"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Atualizar
          </Button>
        </div>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="size-4 text-emerald-400" /> Containers
          </CardTitle>
          <CardDescription>
            {data?.containers.length ?? 0} no total · {containers.length} exibidos · atualiza a cada 5s
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Imagem</TableHead>
                  <TableHead>Portas</TableHead>
                  <TableHead className="text-right">CPU</TableHead>
                  <TableHead className="text-right">Memória</TableHead>
                  <TableHead className="text-right">Rede</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {containers.map((c) => {
                  const running = c.state === 'running'
                  const paused = c.state === 'paused'
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{c.name}</span>
                          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            {c.project && <Badge variant="secondary" className="h-4 px-1 text-[9px]">{c.project}</Badge>}
                            <span className="font-mono">{c.id}</span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge className={cn('w-fit border text-[10px]', stateStyle[c.state] || stateStyle.exited)}>
                            {c.state}
                          </Badge>
                          <span className="max-w-[180px] truncate text-[10px] text-muted-foreground">{c.status}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate font-mono text-xs">{c.image}</TableCell>
                      <TableCell>
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {portList(c.ports).slice(0, 3).map((p) => (
                            <Badge key={p} variant="outline" className="font-mono text-[9px]">
                              {p}
                            </Badge>
                          ))}
                          {portList(c.ports).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                          {portList(c.ports).length > 3 && (
                            <Badge variant="secondary" className="text-[9px]">+{portList(c.ports).length - 3}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.stats ? `${c.stats.cpu.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {c.stats ? (
                          <div className="flex flex-col items-end">
                            <span>{c.stats.memPct}%</span>
                            <span className="text-[10px] text-muted-foreground">{c.stats.memUsage}</span>
                          </div>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-[10px] text-muted-foreground">
                        {c.stats?.netIO || '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {!running && (
                            <ActionBtn title="Iniciar" onClick={() => act(c, 'start')} busy={busy === c.id + 'start'}>
                              <Play className="size-3.5" />
                            </ActionBtn>
                          )}
                          {running && (
                            <>
                              <ActionBtn title="Reiniciar" onClick={() => act(c, 'restart')} busy={busy === c.id + 'restart'}>
                                <RotateCw className="size-3.5" />
                              </ActionBtn>
                              <ActionBtn title="Pausar" onClick={() => act(c, 'pause')} busy={busy === c.id + 'pause'}>
                                <Pause className="size-3.5" />
                              </ActionBtn>
                              <ActionBtn title="Parar" onClick={() => setPending({ container: c, action: 'stop' })} danger>
                                <Square className="size-3.5" />
                              </ActionBtn>
                            </>
                          )}
                          {paused && (
                            <ActionBtn title="Retomar" onClick={() => act(c, 'unpause')} busy={busy === c.id + 'unpause'}>
                              <Play className="size-3.5" />
                            </ActionBtn>
                          )}
                          <ActionBtn
                            title="Ver logs"
                            onClick={() => {
                              setLogTarget(c)
                              setFollow(false)
                              loadLogs(c, tail)
                            }}
                          >
                            <ScrollText className="size-3.5" />
                          </ActionBtn>
                          <ActionBtn title="Matar (SIGKILL)" onClick={() => setPending({ container: c, action: 'kill' })} danger>
                            <Skull className="size-3.5" />
                          </ActionBtn>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {containers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      Nenhum container encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {logTarget && (
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2 font-mono text-sm">
                  <ScrollText className="size-4 text-amber-400" /> {logTarget.name}
                </CardTitle>
                <CardDescription>
                  {logTarget.image} · {tail} últimas linhas
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant={follow ? 'default' : 'outline'} size="sm" onClick={() => setFollow((f) => !f)}>
                  {follow ? 'seguindo' : 'seguir'}
                </Button>
                {[200, 500, 2000].map((n) => (
                  <Button
                    key={n}
                    variant={tail === n ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => {
                      setTail(n)
                      loadLogs(logTarget, n)
                    }}
                  >
                    {n}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={() => loadLogs(logTarget, tail)} disabled={logsLoading}>
                  <RefreshCw className={cn('size-3.5', logsLoading && 'animate-spin')} />
                </Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => { setLogTarget(null); setFollow(false) }}>
                  <X className="size-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[380px] rounded-lg border bg-black/40">
              <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-neutral-200">
                {logsLoading && !logs ? 'carregando…' : logs}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            onClick={() => setShowImages((v) => !v)}
          >
            {showImages ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <ImageIcon className="size-4 text-violet-400" />
            <span className="text-base font-semibold">Imagens</span>
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {data?.images.length ?? 0}
            </Badge>
          </button>
        </CardHeader>
        {showImages && (
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repositório</TableHead>
                  <TableHead>Tag</TableHead>
                  <TableHead>Tamanho</TableHead>
                  <TableHead>Criada</TableHead>
                  <TableHead className="text-right">Containers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.images ?? []).map((img) => (
                  <TableRow key={img.id}>
                    <TableCell className="font-mono text-xs">
                      {img.repository}
                      {img.dangling && (
                        <Badge variant="outline" className="ml-2 h-4 border-amber-500/30 px-1 text-[9px] text-amber-400">
                          dangling
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{img.tag}</TableCell>
                    <TableCell className="font-mono text-xs">{img.size}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{img.createdSince}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{img.containers}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="size-4 text-sky-400" /> Uso de disco do Docker
            </CardTitle>
            <CardDescription>
              {dfTotal > 0 ? `${formatBytes(dfTotal, 1)} recuperáveis com prune` : 'nada recuperável'}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Ativos</TableHead>
                  <TableHead className="text-right">Tamanho</TableHead>
                  <TableHead className="text-right">Recuperável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.df ?? []).map((r) => (
                  <TableRow key={r.Type}>
                    <TableCell className="text-xs font-medium">{r.Type}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.TotalCount}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.Active}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{r.Size}</TableCell>
                    <TableCell className="text-right font-mono text-xs text-amber-400">{r.Reclaimable}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="size-4 text-amber-400" /> Limpeza segura
            </CardTitle>
            <CardDescription>Comandos para liberar espaço (rode no terminal)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Command label="Containers parados" cmd="docker container prune -f" />
            <Command label="Imagens sem uso (dangling)" cmd="docker image prune -f" />
            <Command label="Imagens não usadas (todas)" cmd="docker image prune -a -f" />
            <Command label="Build cache" cmd="docker builder prune -f" />
            <Command label="Volumes órfãos (atenção)" cmd="docker volume prune -f" danger />
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.action === 'kill' ? 'Matar container?' : 'Parar container?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{pending?.container.name}</span> ·{' '}
              {pending?.action === 'kill'
                ? 'envia SIGKILL imediatamente (sem desligamento limpo).'
                : 'envia SIGTERM e aguarda o desligamento limpo.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={pending?.action === 'kill' ? 'bg-destructive text-white hover:bg-destructive/90' : ''}
              onClick={() => {
                if (pending) act(pending.container, pending.action)
                setPending(null)
              }}
            >
              {pending?.action === 'kill' ? 'Matar' : 'Parar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ActionBtn({
  title,
  onClick,
  busy,
  danger,
  children,
}: {
  title: string
  onClick: () => void
  busy?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-7', danger && 'text-muted-foreground hover:text-destructive')}
          onClick={onClick}
          disabled={busy}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}

function Command({ label, cmd, danger }: { label: string; cmd: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-card/40 px-3 py-2">
      <div className="min-w-0">
        <div className="text-xs font-medium">{label}</div>
        <code className="font-mono text-[11px] text-muted-foreground">{cmd}</code>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={cn('size-7 shrink-0', danger && 'text-muted-foreground hover:text-destructive')}
        onClick={() => {
          navigator.clipboard?.writeText(cmd)
          toast.success('Comando copiado')
        }}
      >
        <ScrollText className="size-3.5" />
      </Button>
    </div>
  )
}

function label(action: string) {
  const map: Record<string, string> = {
    start: 'iniciado',
    stop: 'parado',
    restart: 'reiniciado',
    pause: 'pausado',
    unpause: 'retomado',
    kill: 'morto',
  }
  return map[action] || action
}

function parseDockerSize(s: string | undefined) {
  if (!s) return 0
  const m = String(s).match(/([\d.]+)\s*([kKMGT]?B?)/)
  if (!m) return 0
  const n = parseFloat(m[1])
  const unit = m[2].toUpperCase().replace('B', '')
  const mult: Record<string, number> = { '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }
  return n * (mult[unit] || 1)
}
