import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  Cpu,
  Database,
  Eye,
  FolderPlus,
  HardDrive,
  ImagePlus,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  MemoryStick,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Timer,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from '@/components/ui/lucide-animated'
import { toast } from 'sonner'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { TelemetryLoader } from '@/components/ui/telemetry-loader'
import { AreaSeries, Gauge, Sparkline, toneColor } from '@/components/charts'
import { api, sshLogoUrl } from '@/lib/api'
import type {
  SshAuditItem,
  SshAuthType,
  SshConfigHost,
  SshErrorKind,
  SshOverview,
  SshRunbook,
  SshRunbookResult,
  SshServer,
} from '@/lib/api'
import { formatBytes, formatDuration, relTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const POLL_MS = 6000
const selectCls =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'
const rate = (bps: number) => `${formatBytes(bps, 1)}/s`
const clamp = (v: number) => Math.max(0, Math.min(100, v))

const ERROR_KIND_META: Record<
  SshErrorKind,
  { label: string; badgeCls: string }
> = {
  dns: { label: 'DNS / HOSTNAME', badgeCls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  refused: { label: 'PORTA FECHADA', badgeCls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
  timeout: { label: 'TIMEOUT', badgeCls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  unreachable: { label: 'SEM ROTA / REDE', badgeCls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
  host_key: { label: 'HOST KEY ALTERADA', badgeCls: 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-300' },
  auth: { label: 'AUTENTICAÇÃO', badgeCls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
  key_file: { label: 'ARQUIVO DE CHAVE', badgeCls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  binary: { label: 'DEPENDÊNCIA SSH', badgeCls: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
  unknown: { label: 'ERRO SSH', badgeCls: 'border-destructive/40 bg-destructive/10 text-destructive' },
}

function useOverview(ms: number) {
  const [data, setData] = useState<SshOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const timer = useRef<number | undefined>(undefined)
  const alive = useRef(true)

  const tick = useCallback(async () => {
    try {
      const d = await api.sshOverview()
      if (alive.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError(String((e as Error).message || e))
    } finally {
      if (alive.current) {
        setLoading(false)
        timer.current = window.setTimeout(tick, ms)
      }
    }
  }, [ms])

  useEffect(() => {
    alive.current = true
    tick()
    return () => {
      alive.current = false
      clearTimeout(timer.current)
    }
  }, [tick])

  const reload = useCallback(() => {
    clearTimeout(timer.current)
    tick()
  }, [tick])

  return { data, error, loading, reload }
}

function StatBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full transition-all" style={{ width: `${clamp(value)}%`, background: color }} />
    </div>
  )
}

function Metric({
  icon,
  label,
  value,
  pct,
  color,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  pct: number
  color: string
  sub?: string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs">
        <span style={{ color }}>{icon}</span>
        <span className="text-muted-foreground">{label}</span>
        <span className="ml-auto font-mono font-semibold tabular-nums" style={{ color }}>
          {value}
        </span>
      </div>
      <StatBar value={pct} color={color} />
      {sub && <div className="truncate text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span className={cn('size-2.5 shrink-0 rounded-full', online ? 'bg-emerald-400' : 'bg-destructive')}>
      {online && <span className="block size-2.5 animate-ping rounded-full bg-emerald-400/60" />}
    </span>
  )
}

function LogoPicker({
  preview,
  onPick,
  onClear,
}: {
  preview: string | null
  onPick: (dataUrl: string) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState<string | null>(null)

  function pick(file: File | undefined) {
    if (!file) return
    setErr(null)
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return setErr('use PNG, JPG, WEBP ou GIF')
    if (file.size > 1_500_000) return setErr('imagem muito grande (máx 1,5 MB)')
    const reader = new FileReader()
    reader.onload = () => onPick(String(reader.result))
    reader.onerror = () => setErr('falha ao ler o arquivo')
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">Logo</span>
      <div className="flex items-center gap-3">
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-input bg-muted/40">
          {preview ? (
            <img src={preview} alt="" className="size-full object-contain" />
          ) : (
            <ImagePlus className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            <ImagePlus className="size-3.5" /> {preview ? 'Trocar' : 'Enviar PNG'}
          </Button>
          {preview && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={onClear}
            >
              <X className="size-3.5" /> Remover
            </Button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {err && <p className="text-[11px] text-destructive">{err}</p>}
    </div>
  )
}

function ErrorDiagnosticBox({
  server,
  onRetry,
  onResetHostKey,
}: {
  server: SshServer
  onRetry: () => void
  onResetHostKey: (s: SshServer) => void
}) {
  const m = server.metrics
  const kind: SshErrorKind = m?.errorKind || 'unknown'
  const meta = ERROR_KIND_META[kind] ?? ERROR_KIND_META.unknown
  const backoffSec = m?.backoffUntil ? Math.max(0, Math.ceil((m.backoffUntil - Date.now()) / 1000)) : 0

  return (
    <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className={cn('h-4 px-1.5 font-mono text-[9px]', meta.badgeCls)}>
          {meta.label}
        </Badge>
        {(m?.failCount ?? 0) > 1 && (
          <Badge variant="outline" className="h-4 border-muted-foreground/30 px-1.5 font-mono text-[9px] text-muted-foreground">
            {m?.failCount}x falhas{backoffSec > 0 ? ` · pausa ${backoffSec}s` : ''}
          </Badge>
        )}
      </div>

      <p className="text-xs font-medium text-destructive">{m?.error || 'sem resposta'}</p>
      {m?.errorHint && <p className="text-[11px] leading-snug text-muted-foreground">{m.errorHint}</p>}

      {kind === 'host_key' && (
        <Button
          variant="outline"
          size="xs"
          className="w-full gap-1.5 border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20"
          onClick={() => onResetHostKey(server)}
        >
          <ShieldAlert className="size-3.5" /> Aceitar nova chave de host (known_hosts)
        </Button>
      )}

      <div className="flex items-center gap-2 pt-0.5 text-[10px] text-muted-foreground">
        <span>{m?.lastSeen ? `última resposta ${relTime(m.lastSeen)}` : 'nunca respondeu'}</span>
        <Button variant="ghost" size="xs" className="ml-auto h-5 gap-1" onClick={onRetry}>
          <RefreshCw className="size-3" /> testar agora
        </Button>
      </div>
    </div>
  )
}

function ServerCard({
  server,
  clusterLogo,
  onSelect,
  onEdit,
  onDelete,
  onTest,
  onResetHostKey,
}: {
  server: SshServer
  clusterLogo?: string | null
  onSelect: (s: SshServer) => void
  onEdit: (s: SshServer) => void
  onDelete: (s: SshServer) => void
  onTest: (s: SshServer) => void
  onResetHostKey: (s: SshServer) => void
}) {
  const m = server.metrics
  const online = !!m?.online
  const primary = m?.primaryDisk ?? null
  const mem = m?.memory ?? null
  const logo = sshLogoUrl(server.logo) ?? sshLogoUrl(clusterLogo)
  const history = server.history ?? []
  const cpuHist = history.map((h) => h.cpu)
  const memHist = history.map((h) => h.memPct)
  const diskCount = m?.disks?.length ?? 0

  return (
    <Card size="sm" className="group/srv gap-3 transition-colors hover:border-cyan-400/35">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {logo && (
            <img
              src={logo}
              alt=""
              className="size-6 shrink-0 rounded-md border border-input bg-muted/40 object-contain"
            />
          )}
          <StatusDot online={online} />
          <button
            type="button"
            onClick={() => onSelect(server)}
            className="truncate text-left hover:text-cyan-400 hover:underline"
          >
            {server.name}
          </button>
          <Badge variant="outline" className="h-4 gap-1 px-1.5 font-mono text-[10px]">
            {server.authType === 'password' ? (
              <Lock className="size-2.5" />
            ) : server.authType === 'system' ? (
              <Server className="size-2.5" />
            ) : (
              <KeyRound className="size-2.5" />
            )}
            {server.authType === 'password' ? 'senha' : server.authType === 'system' ? 'sistema' : 'chave'}
          </Badge>
          {m?.hostKey?.known && (
            <span
              title={`Host Key verificada (${m.hostKey.keyType}): ${m.hostKey.fingerprint}`}
              className="text-emerald-400"
            >
              <ShieldCheck className="size-3.5" />
            </span>
          )}
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs">
          {server.username ? `${server.username}@` : ''}
          {server.host}
          {server.port ? `:${server.port}` : ''}
        </CardDescription>
        <CardAction className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" title="Detalhes, histórico e comandos" onClick={() => onSelect(server)}>
            <Eye className="text-cyan-400" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Testar conexão" onClick={() => onTest(server)}>
            <Zap className="text-emerald-400" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Editar" onClick={() => onEdit(server)}>
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Remover"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(server)}
          >
            <Trash2 />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        {!online ? (
          <>
            <ErrorDiagnosticBox
              server={server}
              onRetry={() => onTest(server)}
              onResetHostKey={onResetHostKey}
            />
            <Button
              variant="outline"
              size="xs"
              className="w-full justify-between font-mono text-[11px] text-muted-foreground hover:text-cyan-300"
              onClick={() => onSelect(server)}
            >
              <span>Ver diagnóstico, histórico e auditoria</span>
              <ChevronRight className="size-3.5" />
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <Server className="size-3 shrink-0" />
              <span className="truncate">{m?.osName || m?.hostname || server.host}</span>
              <span className="ml-auto shrink-0 font-mono">{m?.uname}</span>
            </div>

            <Metric
              icon={<Cpu className="size-3.5" />}
              label="CPU"
              value={`${(m?.cpuUsage ?? 0).toFixed(0)}%`}
              pct={m?.cpuUsage ?? 0}
              color={toneColor(m?.cpuUsage ?? 0)}
              sub={
                m
                  ? `${m.ncpu ?? '?'} vCPU · load ${(m.loadavg ?? [0, 0, 0]).map((l) => l.toFixed(2)).join(' ')}`
                  : undefined
              }
            />
            <Metric
              icon={<MemoryStick className="size-3.5" />}
              label="Memória"
              value={`${(mem?.memPct ?? 0).toFixed(0)}%`}
              pct={mem?.memPct ?? 0}
              color="#8b5cf6"
              sub={mem ? `${formatBytes(mem.used, 1)} de ${formatBytes(mem.total, 1)}` : undefined}
            />
            <Metric
              icon={<HardDrive className="size-3.5" />}
              label={`Disco ${primary?.mount ?? ''}${diskCount > 1 ? ` (+${diskCount - 1})` : ''}`}
              value={`${(primary?.usedPct ?? 0).toFixed(0)}%`}
              pct={primary?.usedPct ?? 0}
              color={toneColor(primary?.usedPct ?? 0)}
              sub={primary ? `${formatBytes(primary.used, 1)} de ${formatBytes(primary.total, 1)}` : '—'}
            />

            {history.length >= 2 && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-card/30 px-2.5 py-1.5">
                <div>
                  <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Histórico CPU</span>
                    <span className="font-mono text-cyan-400">{history.length} pts</span>
                  </div>
                  <Sparkline data={cpuHist} color="#06b6d4" height={24} />
                </div>
                <div>
                  <div className="mb-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Histórico RAM</span>
                    <span className="font-mono text-violet-400">{(mem?.memPct ?? 0).toFixed(0)}%</span>
                  </div>
                  <Sparkline data={memHist} color="#8b5cf6" height={24} />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 rounded-lg border bg-card/40 px-2.5 py-1.5 font-mono text-xs">
              <span className="flex items-center gap-1 text-sky-400">
                <ArrowDown className="size-3" /> {rate(m?.network?.rxRate ?? 0)}
              </span>
              <span className="flex items-center gap-1 text-fuchsia-400">
                <ArrowUp className="size-3" /> {rate(m?.network?.txRate ?? 0)}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {m?.uptime ? `up ${formatDuration(m.uptime)}` : ''}
              </span>
            </div>

            <Button
              variant="outline"
              size="xs"
              className="w-full justify-between font-mono text-[11px] text-muted-foreground hover:text-cyan-300"
              onClick={() => onSelect(server)}
            >
              <span>Detalhes, discos, runbooks e auditoria</span>
              <ChevronRight className="size-3.5" />
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function AuditTable({ items }: { items: SshAuditItem[] }) {
  if (items.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">Nenhum evento registrado na auditoria ainda.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left font-mono text-xs">
        <thead>
          <tr className="border-b text-[11px] uppercase text-muted-foreground">
            <th className="pb-2 pr-3">Quando</th>
            <th className="pb-2 pr-3">Usuário</th>
            <th className="pb-2 pr-3">Servidor</th>
            <th className="pb-2 pr-3">Ação</th>
            <th className="pb-2 pr-3">Detalhe</th>
            <th className="pb-2 pr-3 text-right">Duração</th>
            <th className="pb-2 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {items.map((a) => (
            <tr key={a.id} className="hover:bg-muted/30">
              <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground" title={new Date(a.ts).toLocaleString()}>
                {relTime(a.ts)}
              </td>
              <td className="py-1.5 pr-3 text-cyan-300">{a.username}</td>
              <td className="py-1.5 pr-3 font-semibold">{a.serverName || '—'}</td>
              <td className="py-1.5 pr-3">
                <Badge variant="outline" className="h-4 px-1.5 font-mono text-[10px]">
                  {a.action}
                </Badge>
              </td>
              <td className="max-w-xs truncate py-1.5 pr-3 text-muted-foreground" title={a.detail ?? ''}>
                {a.detail || '—'}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-3 text-right text-muted-foreground">
                {a.durationMs != null ? `${a.durationMs} ms` : '—'}
              </td>
              <td className="py-1.5 text-right">
                <Badge
                  variant="outline"
                  className={cn(
                    'h-4 px-1.5 text-[10px]',
                    a.status === 'ok'
                      ? 'border-emerald-500/40 text-emerald-400'
                      : 'border-destructive/40 text-destructive'
                  )}
                >
                  {a.status === 'ok' ? 'OK' : 'ERRO'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ServerDetailView({
  serverId,
  initialServer,
  clusterName,
  clusterLogo,
  runbooks,
  onBack,
  onEdit,
  onTest,
  onResetHostKey,
}: {
  serverId: number
  initialServer: SshServer
  clusterName?: string
  clusterLogo?: string | null
  runbooks: SshRunbook[]
  onBack: () => void
  onEdit: (s: SshServer) => void
  onTest: (s: SshServer) => void
  onResetHostKey: (s: SshServer) => void
}) {
  const [server, setServer] = useState<SshServer>(initialServer)
  const [loading, setLoading] = useState(false)
  const [showVirtualIfaces, setShowVirtualIfaces] = useState(false)
  const [pendingRunbook, setPendingRunbook] = useState<SshRunbook | null>(null)
  const [confirmServerName, setConfirmServerName] = useState('')
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runbookResult, setRunbookResult] = useState<SshRunbookResult | null>(null)
  const [copiedFp, setCopiedFp] = useState(false)
  const [copiedOut, setCopiedOut] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const alive = useRef(true)

  const fetchDetail = useCallback(
    async (force = false) => {
      if (force) setLoading(true)
      try {
        const res = await api.sshServerDetail(serverId, 120, force)
        if (alive.current) setServer(res.server)
      } catch (e) {
        if (force) toast.error(String((e as Error).message || e))
      } finally {
        if (alive.current) {
          setLoading(false)
          timer.current = window.setTimeout(() => fetchDetail(false), POLL_MS)
        }
      }
    },
    [serverId]
  )

  useEffect(() => {
    alive.current = true
    fetchDetail(false)
    return () => {
      alive.current = false
      clearTimeout(timer.current)
    }
  }, [fetchDetail])

  async function executeConfirmedRunbook() {
    if (!pendingRunbook) return
    const rb = pendingRunbook
    if (rb.risk === 'high' && confirmServerName.trim() !== server.name) {
      toast.error(`Digite exatamente "${server.name}" para confirmar.`)
      return
    }
    setPendingRunbook(null)
    setConfirmServerName('')
    setRunningId(rb.id)
    const t = toast.loading(`Executando "${rb.title}" em ${server.name}…`)
    try {
      const res = await api.sshExecRunbook(server.id, rb.id, confirmServerName.trim())
      setRunbookResult(res)
      if (res.ok) toast.success(`${rb.title} concluído (${res.durationMs} ms)`, { id: t })
      else toast.error(`${rb.title}: ${res.error || 'retornou erro'}`, { id: t })
      fetchDetail(false)
    } catch (e) {
      toast.error(String((e as Error).message || e), { id: t })
    } finally {
      setRunningId(null)
    }
  }

  const m = server.metrics
  const online = !!m?.online
  const mem = m?.memory ?? null
  const disks = m?.disks ?? []
  const procs = m?.processes ?? []
  const allIfaces = m?.network?.interfaces ?? []
  const ifaces = showVirtualIfaces ? allIfaces : allIfaces.filter((i) => !i.virtual)
  const virtualCount = allIfaces.filter((i) => i.virtual).length
  const history = server.history ?? []
  const audit = server.audit ?? []
  const hostKey = m?.hostKey ?? null
  const logo = sshLogoUrl(server.logo) ?? sshLogoUrl(clusterLogo)

  const cpuSeries = history.map((h) => h.cpu)
  const memSeries = history.map((h) => h.memPct)
  const diskSeries = history.map((h) => h.diskPct)
  const rxSeries = history.map((h) => h.rxRate)
  const txSeries = history.map((h) => h.txRate)

  const totalDiskBytes = disks.reduce((acc, d) => acc + d.total, 0)
  const usedDiskBytes = disks.reduce((acc, d) => acc + d.used, 0)
  const globalDiskPct = totalDiskBytes > 0 ? (usedDiskBytes / totalDiskBytes) * 100 : 0

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cyan-400/20 bg-card/70 px-4 py-3 backdrop-blur-md">
        <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 font-mono text-xs">
          ← Voltar
        </Button>

        {logo && (
          <img
            src={logo}
            alt=""
            className="ml-1 size-8 shrink-0 rounded-lg border border-input bg-muted/40 object-contain"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot online={online} />
            <h2 className="truncate font-mono text-base font-bold tracking-tight">{server.name}</h2>
            {clusterName && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {clusterName}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={cn(
                'font-mono text-[10px]',
                online ? 'border-emerald-500/40 text-emerald-400' : 'border-destructive/40 text-destructive'
              )}
            >
              {online ? 'ONLINE' : 'OFFLINE'}
            </Badge>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
            <span>
              {server.username ? `${server.username}@` : ''}
              {server.host}
              {server.port ? `:${server.port}` : ''}
            </span>
            {m?.hostname && <span>· host: {m.hostname}</span>}
            {m?.osName && <span className="text-cyan-300">· {m.osName}</span>}
            {m?.uname && <span>· {m.uname}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => {
              clearTimeout(timer.current)
              fetchDetail(true)
            }}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Atualizar
          </Button>
          <Button variant="outline" size="sm" onClick={() => onTest(server)}>
            <Zap className="size-3.5 text-emerald-400" /> Testar SSH
          </Button>
          <Button variant="outline" size="sm" onClick={() => onEdit(server)}>
            <Pencil className="size-3.5" /> Editar
          </Button>
        </div>
      </div>

      {/* Host Key Verification Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card/50 px-4 py-2.5 font-mono text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {hostKey?.known ? (
            <>
              <ShieldCheck className="size-4 text-emerald-400" />
              <span className="font-semibold text-emerald-400">Host Key Verificada</span>
              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                {hostKey.keyType}
              </Badge>
              <span className="truncate text-muted-foreground">{hostKey.fingerprint}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                title="Copiar fingerprint"
                onClick={() => {
                  if (hostKey.fingerprint) {
                    navigator.clipboard.writeText(hostKey.fingerprint)
                    setCopiedFp(true)
                    setTimeout(() => setCopiedFp(false), 1500)
                  }
                }}
              >
                {copiedFp ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
              </Button>
            </>
          ) : (
            <>
              <ShieldAlert className="size-4 text-amber-400" />
              <span className="text-amber-300">Host Key ainda não registrada em known_hosts</span>
              <span className="text-muted-foreground">(será gravada automaticamente no primeiro acesso bem-sucedido)</span>
            </>
          )}
        </div>
        {hostKey?.known && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-fuchsia-300"
            onClick={() => onResetHostKey(server)}
          >
            Redefinir chave conhecida
          </Button>
        )}
      </div>

      {!online && (
        <ErrorDiagnosticBox
          server={server}
          onRetry={() => {
            clearTimeout(timer.current)
            fetchDetail(true)
          }}
          onResetHostKey={onResetHostKey}
        />
      )}

      {loading && !server.history && <TelemetryLoader variant="ssh-detail" />}

      {online && (!loading || !!server.history) && (
        <>
          {/* System Summary Strip */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription className="flex items-center gap-1.5 font-mono text-[11px] uppercase">
                  <Cpu className="size-3.5 text-cyan-400" /> Processador
                </CardDescription>
                <CardTitle className="truncate font-mono text-sm">
                  {m?.cpuModel || `${m?.ncpu ?? '?'} vCPU`}
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xs text-muted-foreground">
                {m?.ncpu ?? '?'} núcleos · Load {(m?.loadavg ?? [0, 0, 0]).map((x) => x.toFixed(2)).join(' / ')}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription className="flex items-center gap-1.5 font-mono text-[11px] uppercase">
                  <Timer className="size-3.5 text-emerald-400" /> Uptime & Coleta
                </CardDescription>
                <CardTitle className="font-mono text-sm">
                  {m?.uptime ? formatDuration(m.uptime) : '—'}
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xs text-muted-foreground">
                Coleta SSH em {m?.collectMs ?? '—'} ms · {history.length} snapshots SQLite
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription className="flex items-center gap-1.5 font-mono text-[11px] uppercase">
                  <MemoryStick className="size-3.5 text-violet-400" /> Memória & Swap
                </CardDescription>
                <CardTitle className="font-mono text-sm">
                  {mem ? `${formatBytes(mem.used, 1)} / ${formatBytes(mem.total, 1)}` : '—'}
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xs text-muted-foreground">
                {mem && mem.swapTotal > 0
                  ? `Swap: ${formatBytes(mem.swapUsed, 1)} / ${formatBytes(mem.swapTotal, 1)}`
                  : 'Swap: não configurado'}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader className="pb-1">
                <CardDescription className="flex items-center gap-1.5 font-mono text-[11px] uppercase">
                  <Database className="size-3.5 text-amber-400" /> Armazenamento Total
                </CardDescription>
                <CardTitle className="font-mono text-sm">
                  {formatBytes(usedDiskBytes, 1)} / {formatBytes(totalDiskBytes, 1)}
                </CardTitle>
              </CardHeader>
              <CardContent className="font-mono text-xs text-muted-foreground">
                {disks.length} {disks.length === 1 ? 'volume montado' : 'volumes montados'} ({globalDiskPct.toFixed(1)}%)
              </CardContent>
            </Card>
          </div>

          {/* Gauges + Historical Charts */}
          <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
            <Card size="sm" className="justify-between">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                  <Activity className="size-3.5 text-cyan-400" /> Telemetria Instantânea
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-3 place-items-center gap-2 py-2">
                <Gauge
                  value={m?.cpuUsage ?? 0}
                  size={100}
                  thickness={8}
                  label="CPU"
                  sub={`${m?.ncpu ?? '?'}c`}
                />
                <Gauge
                  value={mem?.memPct ?? 0}
                  size={100}
                  thickness={8}
                  label="RAM"
                  color="#8b5cf6"
                  sub={mem ? formatBytes(mem.used, 0) : ''}
                />
                <Gauge
                  value={m?.primaryDisk?.usedPct ?? 0}
                  size={100}
                  thickness={8}
                  label="Disco /"
                  sub={m?.primaryDisk ? formatBytes(m.primaryDisk.used, 0) : ''}
                />
              </CardContent>
              {mem && (
                <CardContent className="grid grid-cols-3 gap-2 border-t pt-3 text-center font-mono text-[11px]">
                  <div>
                    <div className="text-muted-foreground">Disponível</div>
                    <div className="font-semibold text-emerald-400">{formatBytes(mem.available, 1)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Cache/Buf</div>
                    <div className="font-semibold text-cyan-300">{formatBytes(mem.cached + mem.buffers, 1)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Livre</div>
                    <div className="font-semibold">{formatBytes(mem.free, 1)}</div>
                  </div>
                </CardContent>
              )}
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
                    <span>Histórico CPU, RAM & Disco (%)</span>
                    <span className="font-mono text-[10px] text-cyan-400">{history.length} amostras</span>
                  </CardTitle>
                  <CardDescription className="flex items-center gap-3 font-mono text-[11px]">
                    <span className="text-cyan-400">● CPU {(m?.cpuUsage ?? 0).toFixed(1)}%</span>
                    <span className="text-violet-400">● RAM {(mem?.memPct ?? 0).toFixed(1)}%</span>
                    <span className="text-amber-400">● Disco {(m?.primaryDisk?.usedPct ?? 0).toFixed(1)}%</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AreaSeries
                    height={145}
                    max={100}
                    series={[
                      { name: 'CPU', color: '#06b6d4', data: cpuSeries },
                      { name: 'RAM', color: '#8b5cf6', data: memSeries },
                      { name: 'Disco', color: '#f59e0b', data: diskSeries },
                    ]}
                  />
                </CardContent>
              </Card>

              <Card size="sm">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
                    <span>Histórico de Rede (RX / TX)</span>
                    <span className="font-mono text-[10px] text-sky-400">
                      pico {rate(Math.max(0, ...rxSeries, ...txSeries))}
                    </span>
                  </CardTitle>
                  <CardDescription className="flex items-center gap-3 font-mono text-[11px]">
                    <span className="text-sky-400">↓ RX {rate(m?.network?.rxRate ?? 0)}</span>
                    <span className="text-fuchsia-400">↑ TX {rate(m?.network?.txRate ?? 0)}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AreaSeries
                    height={145}
                    series={[
                      { name: 'RX', color: '#38bdf8', data: rxSeries },
                      { name: 'TX', color: '#e879f9', data: txSeries },
                    ]}
                  />
                </CardContent>
              </Card>
            </div>
          </div>

          {/* All Disks & Network Interfaces */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Disks */}
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <HardDrive className="size-4 text-cyan-400" /> Todos os Volumes Montados ({disks.length})
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  Partições e sistemas de arquivos reportados pelo servidor remoto
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {disks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum disco detectado.</p>
                ) : (
                  disks.map((d) => {
                    const col = toneColor(d.usedPct)
                    return (
                      <div key={`${d.fs}-${d.mount}`} className="space-y-1.5 rounded-lg border bg-card/40 p-2.5">
                        <div className="flex items-center gap-2 font-mono text-xs">
                          <span className="font-semibold text-foreground">{d.mount}</span>
                          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                            {d.fstype || 'fs'}
                          </Badge>
                          <span className="truncate text-muted-foreground">{d.fs}</span>
                          <span className="ml-auto font-semibold tabular-nums" style={{ color: col }}>
                            {d.usedPct.toFixed(1)}%
                          </span>
                        </div>
                        <StatBar value={d.usedPct} color={col} />
                        <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
                          <span>Usado: {formatBytes(d.used, 1)}</span>
                          <span>Livre: {formatBytes(d.avail, 1)}</span>
                          <span>Total: {formatBytes(d.total, 1)}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>

            {/* Network Interfaces */}
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Network className="size-4 text-sky-400" /> Interfaces de Rede ({ifaces.length})
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  Tráfego por placa de rede, IPv4 e contadores acumulados
                </CardDescription>
                {virtualCount > 0 && (
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="xs"
                      className="font-mono text-[11px]"
                      onClick={() => setShowVirtualIfaces((v) => !v)}
                    >
                      {showVirtualIfaces ? 'Ocultar virtuais' : `Mostrar virtuais (+${virtualCount})`}
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className="space-y-2.5">
                {ifaces.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma interface ativa para exibir.</p>
                ) : (
                  ifaces.map((iface) => {
                    const errs = (iface.rxErrs ?? 0) + (iface.txErrs ?? 0)
                    return (
                      <div
                        key={iface.name}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card/40 px-3 py-2 font-mono text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{iface.name}</span>
                            {iface.ipv4 && (
                              <Badge variant="secondary" className="h-4 px-1.5 font-mono text-[10px] text-cyan-300">
                                {iface.ipv4}
                              </Badge>
                            )}
                            {iface.virtual && (
                              <Badge variant="outline" className="h-4 px-1.5 text-[9px] text-muted-foreground">
                                virtual
                              </Badge>
                            )}
                            {errs > 0 && (
                              <Badge variant="outline" className="h-4 border-amber-500/40 px-1.5 text-[9px] text-amber-400">
                                {errs} err
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Total RX: {formatBytes(iface.rx, 1)} · Total TX: {formatBytes(iface.tx, 1)}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1 text-sky-400">
                            <ArrowDown className="size-3" /> {rate(iface.rxRate)}
                          </span>
                          <span className="flex items-center gap-1 text-fuchsia-400">
                            <ArrowUp className="size-3" /> {rate(iface.txRate)}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top Processes */}
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Layers className="size-4 text-emerald-400" /> Principais Processos em Execução ({procs.length})
              </CardTitle>
              <CardDescription className="font-mono text-xs">
                Ordenados por consumo de CPU no servidor remoto
              </CardDescription>
            </CardHeader>
            <CardContent>
              {procs.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum processo retornado.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead>
                      <tr className="border-b text-[11px] uppercase text-muted-foreground">
                        <th className="pb-2 pr-3">PID</th>
                        <th className="pb-2 pr-3">Processo</th>
                        <th className="pb-2 pr-3">Usuário</th>
                        <th className="pb-2 pr-3 text-right">CPU %</th>
                        <th className="pb-2 pr-3 text-right">RAM %</th>
                        <th className="pb-2 text-right">RSS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {procs.map((p) => (
                        <tr key={p.pid} className="hover:bg-muted/30">
                          <td className="py-1.5 pr-3 text-muted-foreground">{p.pid}</td>
                          <td className="py-1.5 pr-3 font-semibold text-foreground">{p.name}</td>
                          <td className="py-1.5 pr-3 text-muted-foreground">{p.user}</td>
                          <td
                            className="py-1.5 pr-3 text-right font-semibold tabular-nums"
                            style={{ color: toneColor(p.cpu) }}
                          >
                            {p.cpu.toFixed(1)}%
                          </td>
                          <td className="py-1.5 pr-3 text-right tabular-nums text-violet-300">
                            {p.memPct.toFixed(1)}%
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                            {formatBytes(p.mem, 1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Pre-defined Commands (Runbooks) */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Terminal className="size-4 text-cyan-400" /> Comandos Pré-Definidos (Runbooks)
          </CardTitle>
          <CardDescription className="font-mono text-xs">
            Execute diagnósticos e ações controladas por SSH com confirmação prévia e registro em auditoria
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {runbooks.map((rb) => {
              const isRunning = runningId === rb.id
              const riskBadge =
                rb.risk === 'high'
                  ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                  : rb.risk === 'medium'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                    : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
              return (
                <div
                  key={rb.id}
                  className="flex flex-col justify-between gap-2 rounded-xl border bg-card/40 p-3 transition-colors hover:border-cyan-400/35"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <Badge variant="outline" className="h-4 px-1.5 font-mono text-[9px]">
                        {rb.category}
                      </Badge>
                      <Badge variant="outline" className={cn('h-4 px-1.5 font-mono text-[9px]', riskBadge)}>
                        {rb.risk === 'high' ? 'CRÍTICO' : rb.risk === 'medium' ? 'AÇÃO' : 'LEITURA'}
                      </Badge>
                    </div>
                    <div className="text-xs font-semibold">{rb.title}</div>
                    <p className="text-[11px] leading-snug text-muted-foreground">{rb.desc}</p>
                  </div>
                  <div className="space-y-2 pt-1">
                    <div className="truncate rounded bg-muted/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                      $ {rb.commandPreview}
                    </div>
                    <Button
                      variant={rb.risk === 'high' ? 'destructive' : 'outline'}
                      size="xs"
                      className="w-full gap-1.5 font-mono"
                      disabled={runningId != null}
                      onClick={() => {
                        setConfirmServerName('')
                        setPendingRunbook(rb)
                      }}
                    >
                      {isRunning ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
                      Executar
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          {runbookResult && (
            <div className="space-y-2 rounded-xl border border-cyan-400/30 bg-black/75 p-3 font-mono text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      'h-4 px-1.5 text-[10px]',
                      runbookResult.ok
                        ? 'border-emerald-500/40 text-emerald-400'
                        : 'border-destructive/40 text-destructive'
                    )}
                  >
                    {runbookResult.ok ? `OK (exit ${runbookResult.code})` : `ERRO (exit ${runbookResult.code})`}
                  </Badge>
                  <span className="font-semibold text-cyan-300">{runbookResult.runbook.title}</span>
                  <span className="text-[11px] text-muted-foreground">· {runbookResult.durationMs} ms</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-6 gap-1 text-[11px]"
                    onClick={() => {
                      navigator.clipboard.writeText(runbookResult.stdout || runbookResult.stderr || '')
                      setCopiedOut(true)
                      setTimeout(() => setCopiedOut(false), 1500)
                    }}
                  >
                    {copiedOut ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />} Copiar
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => setRunbookResult(null)}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              </div>
              {runbookResult.error && (
                <div className="rounded border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-destructive">
                  {runbookResult.error}
                  {runbookResult.errorHint ? ` — ${runbookResult.errorHint}` : ''}
                </div>
              )}
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-200">
                {(runbookResult.stdout || runbookResult.stderr || '(sem saída)').trim()}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Server Audit History */}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScrollText className="size-4 text-violet-400" /> Log de Auditoria deste Servidor ({audit.length})
          </CardTitle>
          <CardDescription className="font-mono text-xs">
            Histórico de testes, alterações cadastrais, verificações de chave e comandos executados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AuditTable items={audit} />
        </CardContent>
      </Card>

      {/* Runbook Confirmation Dialog */}
      <AlertDialog open={!!pendingRunbook} onOpenChange={(v) => !v && setPendingRunbook(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {pendingRunbook?.risk === 'high' ? (
                <TriangleAlert className="size-4 text-destructive" />
              ) : (
                <Terminal className="size-4 text-cyan-400" />
              )}
              Confirmar execução: {pendingRunbook?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              O comando abaixo será executado via SSH em{' '}
              <span className="font-mono font-semibold text-foreground">
                {server.name} ({server.host})
              </span>{' '}
              e registrado no log de auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-1">
            <div className="rounded-lg border bg-muted/50 px-3 py-2 font-mono text-xs text-cyan-300">
              $ {pendingRunbook?.commandPreview}
            </div>

            {pendingRunbook?.risk === 'high' && (
              <label className="block space-y-1.5 text-xs font-medium text-destructive">
                Esta ação é destrutiva/crítica. Digite o nome do servidor ({server.name}) para liberar:
                <Input
                  value={confirmServerName}
                  onChange={(e) => setConfirmServerName(e.target.value)}
                  placeholder={server.name}
                  className="font-mono"
                  autoFocus
                />
              </label>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={pendingRunbook?.risk === 'high' && confirmServerName.trim() !== server.name}
              className={cn(
                pendingRunbook?.risk === 'high' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              )}
              onClick={(e) => {
                e.preventDefault()
                executeConfirmedRunbook()
              }}
            >
              Executar agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ServerDialog({
  open,
  onOpenChange,
  clusters,
  editing,
  presetCluster,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  clusters: { id: number; name: string }[]
  editing: SshServer | null
  presetCluster: number | null
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [authType, setAuthType] = useState<SshAuthType>('key')
  const [secret, setSecret] = useState('')
  const [clusterId, setClusterId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [configHosts, setConfigHosts] = useState<SshConfigHost[]>([])
  const [configFile, setConfigFile] = useState<string>('')
  const [logoData, setLogoData] = useState<string | null>(null)
  const [logoCleared, setLogoCleared] = useState(false)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSecret('')
    setBusy(false)
    setLogoData(null)
    setLogoCleared(false)
    api
      .sshConfig()
      .then((c) => {
        setConfigHosts(c.hosts)
        setConfigFile(c.file)
      })
      .catch(() => setConfigHosts([]))
    if (editing) {
      setName(editing.name)
      setHost(editing.host)
      setPort(editing.port ? String(editing.port) : '')
      setUsername(editing.username)
      setAuthType(editing.authType)
      setClusterId(editing.clusterId != null ? String(editing.clusterId) : '')
    } else {
      setName('')
      setHost('')
      setPort('22')
      setUsername('')
      setAuthType('key')
      setClusterId(presetCluster != null ? String(presetCluster) : '')
    }
  }, [open, editing, presetCluster])

  const needsSecret = authType !== 'system' && (!editing?.hasSecret || editing.authType !== authType)

  function pickHost(alias: string) {
    const h = configHosts.find((x) => x.alias === alias)
    if (!h) return
    setHost(h.alias)
    setUsername(h.user || '')
    setPort(h.port ? String(h.port) : '')
  }

  async function submit() {
    setError(null)
    if (!name.trim()) return setError('informe um nome')
    if (!host.trim()) return setError('informe o host')
    if (authType !== 'system' && !username.trim()) return setError('informe o usuário')
    if (needsSecret && !secret.trim()) return setError(authType === 'password' ? 'informe a senha' : 'informe o caminho da chave')
    setBusy(true)
    try {
      const payload = {
        name: name.trim(),
        host: host.trim(),
        port: authType === 'system' ? Number(port) || 0 : Number(port) || 22,
        username: username.trim(),
        authType,
        secret: secret.trim() || undefined,
        clusterId: clusterId === '' ? null : Number(clusterId),
        logo: logoData ?? (logoCleared ? '' : undefined),
      }
      if (editing) await api.sshUpdateServer(editing.id, payload)
      else await api.sshCreateServer(payload)
      toast.success(editing ? 'Servidor atualizado' : 'Servidor adicionado')
      onOpenChange(false)
      onSaved()
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Server className="size-4 text-emerald-400" /> {editing ? 'Editar servidor' : 'Adicionar servidor'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            A coleta é feita por SSH, somente leitura (cpu, memória, disco e rede). Nada é instalado no alvo.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Nome
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="web-01" autoFocus />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Cluster
              <select className={selectCls} value={clusterId} onChange={(e) => setClusterId(e.target.value)}>
                <option value="">Sem cluster</option>
                {clusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <LogoPicker
            preview={logoData ?? (logoCleared ? null : sshLogoUrl(editing?.logo))}
            onPick={(dataUrl) => {
              setLogoData(dataUrl)
              setLogoCleared(false)
            }}
            onClear={() => {
              setLogoData(null)
              setLogoCleared(true)
            }}
          />

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Autenticação</span>
            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={authType === 'system' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setAuthType('system')}
              >
                <Server className="size-3.5" /> Sistema
              </Button>
              <Button
                type="button"
                variant={authType === 'key' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setAuthType('key')}
              >
                <KeyRound className="size-3.5" /> Chave
              </Button>
              <Button
                type="button"
                variant={authType === 'password' ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setAuthType('password')}
              >
                <Lock className="size-3.5" /> Senha
              </Button>
            </div>
          </div>

          {authType === 'system' && configHosts.length > 0 && (
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Servidor do ~/.ssh/config
              <select
                className={selectCls}
                value={configHosts.some((h) => h.alias === host) ? host : ''}
                onChange={(e) => pickHost(e.target.value)}
              >
                <option value="">— digitar manualmente —</option>
                {configHosts.map((h) => (
                  <option key={h.alias} value={h.alias}>
                    {h.alias}
                    {h.hostName ? ` · ${h.hostName}` : ''}
                    {h.user ? ` (${h.user})` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_100px]">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              {authType === 'system' ? 'Host ou apelido' : 'Host (IP ou DNS)'}
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder={authType === 'system' ? 'apelido-do-config ou 10.0.0.10' : '10.0.0.10 ou srv.exemplo.com'}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Porta
              <Input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                placeholder={authType === 'system' ? 'auto' : '22'}
              />
            </label>
          </div>

          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            {authType === 'system' ? 'Usuário SSH (opcional)' : 'Usuário SSH'}
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={authType === 'system' ? 'do config (opcional)' : 'root'}
            />
          </label>

          {authType === 'key' && (
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Caminho da chave privada (no host do painel)
              <Input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="~/.ssh/id_ed25519"
                className="font-mono"
              />
            </label>
          )}
          {authType === 'password' && (
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Senha SSH
              <Input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={needsSecret ? 'senha do usuário' : 'deixe vazio para manter a atual'}
                autoComplete="new-password"
              />
            </label>
          )}

          {editing && editing.hasSecret && !needsSecret && (
            <p className="text-[11px] text-muted-foreground">Deixe a credencial em branco para manter a atual.</p>
          )}
          {authType === 'password' && (
            <p className="text-[11px] text-muted-foreground">
              Autenticação por senha requer o binário <span className="font-mono">sshpass</span> instalado no host do painel.
            </p>
          )}
          {authType === 'system' && (
            <p className="text-[11px] text-muted-foreground">
              Usa o <span className="font-mono">~/.ssh/config</span>, o <span className="font-mono">ssh-agent</span> e as
              chaves padrão do usuário do painel{configFile ? <> (<span className="font-mono">{configFile}</span>)</> : null}. Nenhum
              segredo é guardado no banco.
            </p>
          )}
          {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Salvar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ClusterDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: { id: number; name: string; logo: string | null } | null
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [logoData, setLogoData] = useState<string | null>(null)
  const [logoCleared, setLogoCleared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? '')
    setLogoData(null)
    setLogoCleared(false)
    setError(null)
    setBusy(false)
  }, [open, editing])

  async function submit() {
    if (!name.trim()) return setError('informe um nome')
    setBusy(true)
    setError(null)
    const logo = logoData ?? (logoCleared ? '' : undefined)
    try {
      if (editing) await api.sshUpdateCluster(editing.id, { name: name.trim(), logo })
      else await api.sshCreateCluster(name.trim(), logoData ?? undefined)
      toast.success(editing ? 'Cluster atualizado' : 'Cluster criado')
      onOpenChange(false)
      onSaved()
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  const preview = logoData ?? (logoCleared ? null : sshLogoUrl(editing?.logo))

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <FolderPlus className="size-4 text-emerald-400" /> {editing ? 'Editar cluster' : 'Novo cluster'}
          </AlertDialogTitle>
          <AlertDialogDescription>Agrupe servidores por ambiente, cliente ou projeto.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-3 py-1">
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            Nome
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Prefeitura" autoFocus />
          </label>
          <LogoPicker
            preview={preview}
            onPick={(dataUrl) => {
              setLogoData(dataUrl)
              setLogoCleared(false)
            }}
            onClear={() => {
              setLogoData(null)
              setLogoCleared(true)
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} {editing ? 'Salvar' : 'Criar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function SshPanel() {
  const { data, error, loading, reload } = useOverview(POLL_MS)
  const [clusterOpen, setClusterOpen] = useState(false)
  const [serverOpen, setServerOpen] = useState(false)
  const [editing, setEditing] = useState<SshServer | null>(null)
  const [presetCluster, setPresetCluster] = useState<number | null>(null)
  const [confirm, setConfirm] = useState<{ type: 'server' | 'cluster'; id: number; name: string } | null>(null)
  const [editingCluster, setEditingCluster] = useState<{ id: number; name: string; logo: string | null } | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [runbooks, setRunbooks] = useState<SshRunbook[]>([])
  const [hostKeyTarget, setHostKeyTarget] = useState<SshServer | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const [globalAudit, setGlobalAudit] = useState<SshAuditItem[]>([])

  useEffect(() => {
    api
      .sshRunbooks()
      .then((r) => setRunbooks(r.runbooks))
      .catch(() => setRunbooks([]))
  }, [])

  const clusters = data?.clusters ?? []
  const named = clusters.filter((c) => c.id != null).map((c) => ({ id: c.id as number, name: c.name }))
  const total = clusters.reduce((a, c) => a + c.servers.length, 0)
  const online = clusters.reduce((a, c) => a + c.servers.filter((s) => s.metrics?.online).length, 0)

  const selectedEntry = (() => {
    if (selectedId == null) return null
    for (const c of clusters) {
      const s = c.servers.find((sv) => sv.id === selectedId)
      if (s) return { server: s, cluster: c }
    }
    return null
  })()

  function openAdd(preset: number | null) {
    setEditing(null)
    setPresetCluster(preset)
    setServerOpen(true)
  }

  function openCluster(cluster: { id: number; name: string; logo: string | null } | null) {
    setEditingCluster(cluster)
    setClusterOpen(true)
  }

  async function openGlobalAudit() {
    setAuditOpen(true)
    try {
      const r = await api.sshAudit(null, 100)
      setGlobalAudit(r.items)
    } catch (e) {
      toast.error(String((e as Error).message || e))
    }
  }

  async function testServer(s: SshServer) {
    const t = toast.loading(`Testando ${s.name}…`)
    try {
      const r = await api.sshTestServer(s.id)
      if (r.ok) {
        toast.success(`${s.name}: online (${r.hostname ?? s.host} · ${r.uname ?? ''})`, { id: t })
      } else {
        const kindLabel = r.errorKind ? ERROR_KIND_META[r.errorKind]?.label : 'ERRO'
        toast.error(`${s.name} [${kindLabel}]: ${r.error || 'falhou'}`, { id: t })
      }
    } catch (e) {
      toast.error(`${s.name}: ${String((e as Error).message || e)}`, { id: t })
    } finally {
      reload()
    }
  }

  async function confirmResetHostKey() {
    if (!hostKeyTarget) return
    const target = hostKeyTarget
    setHostKeyTarget(null)
    const t = toast.loading(`Redefinindo chave conhecida de ${target.name}…`)
    try {
      const r = await api.sshResetHostKey(target.id)
      if (r.metrics?.online) {
        toast.success(
          `Nova chave de ${target.name} aceita (${r.metrics.hostKey?.fingerprint ?? 'conectado'})`,
          { id: t }
        )
      } else {
        toast.info(`Chave antiga removida de known_hosts (${r.removed}). Status: ${r.metrics?.error || 'testado'}`, {
          id: t,
        })
      }
    } catch (e) {
      toast.error(String((e as Error).message || e), { id: t })
    } finally {
      reload()
    }
  }

  async function doConfirm() {
    if (!confirm) return
    try {
      if (confirm.type === 'server') {
        await api.sshDeleteServer(confirm.id)
        if (selectedId === confirm.id) setSelectedId(null)
      } else {
        await api.sshDeleteCluster(confirm.id)
      }
      toast.success(confirm.type === 'server' ? 'Servidor removido' : 'Cluster removido')
    } catch (e) {
      toast.error(String((e as Error).message || e))
    } finally {
      setConfirm(null)
      reload()
    }
  }

  return (
    <div className="space-y-4">
      {selectedEntry ? (
        <ServerDetailView
          serverId={selectedEntry.server.id}
          initialServer={selectedEntry.server}
          clusterName={selectedEntry.cluster.name}
          clusterLogo={selectedEntry.cluster.logo}
          runbooks={runbooks}
          onBack={() => setSelectedId(null)}
          onEdit={(sv) => {
            setEditing(sv)
            setPresetCluster(null)
            setServerOpen(true)
          }}
          onTest={testServer}
          onResetHostKey={(sv) => setHostKeyTarget(sv)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Server className="size-4 text-emerald-400" />
              {total > 0 ? (
                <span>
                  <span className="font-medium text-foreground">{online}</span> de{' '}
                  <span className="font-medium text-foreground">{total}</span> servidores online
                </span>
              ) : loading ? (
                <span>Sincronizando servidores remotos via SSH…</span>
              ) : (
                <span>Nenhum servidor remoto configurado</span>
              )}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={openGlobalAudit}>
                <ScrollText className="size-4 text-violet-400" /> Auditoria
              </Button>
              <Button variant="outline" size="sm" onClick={() => openCluster(null)}>
                <FolderPlus className="size-4" /> Novo cluster
              </Button>
              <Button size="sm" onClick={() => openAdd(null)}>
                <Plus className="size-4" /> Adicionar servidor
              </Button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {loading && !data && <TelemetryLoader variant="ssh" />}

          {!loading && total === 0 && (
            <Card className="items-center py-12 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/25">
                <Server className="size-6" />
              </div>
              <div className="mt-3 text-sm font-medium">Nenhum servidor remoto</div>
              <p className="mt-1 max-w-md px-6 text-xs text-muted-foreground">
                Adicione servidores por SSH para acompanhar CPU, memória, disco e rede de cada máquina, agrupadas em
                clusters.
              </p>
              <div className="mt-4 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => openCluster(null)}>
                  <FolderPlus className="size-4" /> Criar cluster
                </Button>
                <Button size="sm" onClick={() => openAdd(null)}>
                  <Plus className="size-4" /> Adicionar servidor
                </Button>
              </div>
            </Card>
          )}

          {clusters.map((cluster) => (
            <section key={cluster.id ?? 'none'} className="space-y-3">
              <div className="flex items-center gap-2">
                {cluster.logo && (
                  <img src={sshLogoUrl(cluster.logo) ?? ''} alt="" className="size-5 shrink-0 rounded object-contain" />
                )}
                <h3 className="text-sm font-semibold">{cluster.name}</h3>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {cluster.servers.length}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {cluster.servers.filter((s) => s.metrics?.online).length} online
                </span>
                {cluster.id != null && (
                  <div className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="xs" className="gap-1" onClick={() => openAdd(cluster.id)}>
                      <Plus className="size-3" /> servidor
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Editar cluster"
                      className="text-muted-foreground"
                      onClick={() => openCluster({ id: cluster.id as number, name: cluster.name, logo: cluster.logo })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="Remover cluster"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setConfirm({ type: 'cluster', id: cluster.id as number, name: cluster.name })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </div>

              {cluster.servers.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  Nenhum servidor neste cluster.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {cluster.servers.map((s) => (
                    <ServerCard
                      key={s.id}
                      server={s}
                      clusterLogo={cluster.logo}
                      onSelect={(sv) => setSelectedId(sv.id)}
                      onEdit={(sv) => {
                        setEditing(sv)
                        setPresetCluster(null)
                        setServerOpen(true)
                      }}
                      onDelete={(sv) => setConfirm({ type: 'server', id: sv.id, name: sv.name })}
                      onTest={testServer}
                      onResetHostKey={(sv) => setHostKeyTarget(sv)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </>
      )}

      <ServerDialog
        open={serverOpen}
        onOpenChange={setServerOpen}
        clusters={named}
        editing={editing}
        presetCluster={presetCluster}
        onSaved={reload}
      />

      <ClusterDialog open={clusterOpen} onOpenChange={setClusterOpen} editing={editingCluster} onSaved={reload} />

      {/* Host Key Reset Confirmation */}
      <AlertDialog open={!!hostKeyTarget} onOpenChange={(v) => !v && setHostKeyTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-fuchsia-400" /> Redefinir Host Key de {hostKeyTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Isso removerá a chave pública atual de{' '}
              <span className="font-mono font-semibold text-foreground">{hostKeyTarget?.host}</span> do arquivo{' '}
              <span className="font-mono">known_hosts</span> do painel e aceitará a nova chave enviada pelo servidor na
              próxima conexão. Faça isso apenas se você reinstalou ou trocou a chave do servidor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmResetHostKey()
              }}
            >
              Aceitar nova chave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Global Audit Modal */}
      <AlertDialog open={auditOpen} onOpenChange={setAuditOpen}>
        <AlertDialogContent className="sm:max-w-4xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ScrollText className="size-4 text-violet-400" /> Log Global de Auditoria SSH
            </AlertDialogTitle>
            <AlertDialogDescription>
              Registro cronológico de cadastros, testes de conexão, rotações de Host Key e comandos pré-definidos
              executados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[60vh] overflow-y-auto py-2">
            <AuditTable items={globalAudit} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {confirm?.type === 'cluster' ? 'cluster' : 'servidor'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === 'cluster'
                ? `O cluster "${confirm?.name}" será removido. Os servidores dele ficam "Sem cluster" (não são apagados).`
                : `O servidor "${confirm?.name}" será removido do painel. Nada muda na máquina remota.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive/10 text-destructive hover:bg-destructive/20"
              onClick={(e) => {
                e.preventDefault()
                doConfirm()
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
