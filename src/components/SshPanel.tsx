import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Cpu,
  FolderPlus,
  HardDrive,
  ImagePlus,
  KeyRound,
  Loader2,
  Lock,
  MemoryStick,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
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
import { toneColor } from '@/components/charts'
import { api, sshLogoUrl } from '@/lib/api'
import type { SshAuthType, SshConfigHost, SshOverview, SshServer } from '@/lib/api'
import { formatBytes, formatDuration, relTime } from '@/lib/format'
import { cn } from 'cn'

const POLL_MS = 6000
const selectCls =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'
const rate = (bps: number) => `${formatBytes(bps, 1)}/s`
const clamp = (v: number) => Math.max(0, Math.min(100, v))

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

function ServerCard({
  server,
  clusterLogo,
  onEdit,
  onDelete,
  onTest,
  onReload,
}: {
  server: SshServer
  clusterLogo?: string | null
  onEdit: (s: SshServer) => void
  onDelete: (s: SshServer) => void
  onTest: (s: SshServer) => void
  onReload: () => void
}) {
  const m = server.metrics
  const online = !!m?.online
  const primary = m?.primaryDisk ?? null
  const mem = m?.memory ?? null
  const logo = sshLogoUrl(server.logo) ?? sshLogoUrl(clusterLogo)

  return (
    <Card size="sm" className="gap-3">
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
          <span className="truncate">{server.name}</span>
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
        </CardTitle>
        <CardDescription className="truncate font-mono text-xs">
          {server.username}@{server.host}:{server.port}
        </CardDescription>
        <CardAction className="flex items-center gap-0.5">
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
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
            <p className="text-xs text-destructive">{m?.error || 'sem resposta'}</p>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{m?.lastSeen ? `última resposta ${relTime(m.lastSeen)}` : 'nunca respondeu'}</span>
              <Button variant="ghost" size="xs" className="ml-auto h-5 gap-1" onClick={onReload}>
                <RefreshCw className="size-3" /> tentar
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <Server className="size-3" />
              <span className="truncate">{m?.hostname || server.host}</span>
              <span className="ml-auto shrink-0">{m?.uname}</span>
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
              label={`Disco ${primary?.mount ?? ''}`}
              value={`${(primary?.usedPct ?? 0).toFixed(0)}%`}
              pct={primary?.usedPct ?? 0}
              color={toneColor(primary?.usedPct ?? 0)}
              sub={primary ? `${formatBytes(primary.used, 1)} de ${formatBytes(primary.total, 1)}` : '—'}
            />

            <div className="flex items-center gap-4 rounded-lg border bg-card/40 px-2.5 py-1.5 font-mono text-xs">
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
          </>
        )}
      </CardContent>
    </Card>
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
                placeholder={authType === 'system' ? 'pmtf-root ou 10.0.0.10' : '10.0.0.10 ou srv.exemplo.com'}
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

  const clusters = data?.clusters ?? []
  const named = clusters.filter((c) => c.id != null).map((c) => ({ id: c.id as number, name: c.name }))
  const total = clusters.reduce((a, c) => a + c.servers.length, 0)
  const online = clusters.reduce((a, c) => a + c.servers.filter((s) => s.metrics?.online).length, 0)

  function openAdd(preset: number | null) {
    setEditing(null)
    setPresetCluster(preset)
    setServerOpen(true)
  }

  function openCluster(cluster: { id: number; name: string; logo: string | null } | null) {
    setEditingCluster(cluster)
    setClusterOpen(true)
  }

  async function testServer(s: SshServer) {
    const t = toast.loading(`Testando ${s.name}…`)
    try {
      const r = await api.sshTestServer(s.id)
      if (r.ok) toast.success(`${s.name}: online (${r.hostname ?? s.host} · ${r.uname ?? ''})`, { id: t })
      else toast.error(`${s.name}: ${r.error || 'falhou'}`, { id: t })
    } catch (e) {
      toast.error(`${s.name}: ${String((e as Error).message || e)}`, { id: t })
    } finally {
      reload()
    }
  }

  async function doConfirm() {
    if (!confirm) return
    try {
      if (confirm.type === 'server') await api.sshDeleteServer(confirm.id)
      else await api.sshDeleteCluster(confirm.id)
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
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Server className="size-4 text-emerald-400" />
          {total > 0 ? (
            <span>
              <span className="font-medium text-foreground">{online}</span> de{' '}
              <span className="font-medium text-foreground">{total}</span> servidores online
            </span>
          ) : (
            <span>Nenhum servidor remoto configurado</span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openCluster(null)}>
            <FolderPlus className="size-4" /> Novo cluster
          </Button>
          <Button size="sm" onClick={() => openAdd(null)}>
            <Plus className="size-4" /> Adicionar servidor
          </Button>
        </div>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {!loading && total === 0 && (
        <Card className="items-center py-12 text-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/25">
            <Server className="size-6" />
          </div>
          <div className="mt-3 text-sm font-medium">Nenhum servidor remoto</div>
          <p className="mt-1 max-w-md px-6 text-xs text-muted-foreground">
            Adicione servidores por SSH para acompanhar CPU, memória, disco e rede de cada máquina, agrupadas em clusters.
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
                  onEdit={(sv) => {
                    setEditing(sv)
                    setPresetCluster(null)
                    setServerOpen(true)
                  }}
                  onDelete={(sv) => setConfirm({ type: 'server', id: sv.id, name: sv.name })}
                  onTest={testServer}
                  onReload={reload}
                />
              ))}
            </div>
          )}
        </section>
      ))}

      <ServerDialog
        open={serverOpen}
        onOpenChange={setServerOpen}
        clusters={named}
        editing={editing}
        presetCluster={presetCluster}
        onSaved={reload}
      />

      <ClusterDialog
        open={clusterOpen}
        onOpenChange={setClusterOpen}
        editing={editingCluster}
        onSaved={reload}
      />

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
