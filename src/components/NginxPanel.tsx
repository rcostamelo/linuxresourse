import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  CircleCheckIcon,
  Copy,
  File,
  Globe,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  Lock,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  ScrollText,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
  Waypoints,
  X,
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { StatCard } from '@/components/StatCard'
import { SudoConfigModal } from '@/components/OsUsersPanel'
import {
  api,
  type NginxConfigItem,
  type NginxLogsResponse,
  type NginxOverview,
  type NginxScope,
  type NginxTestResult,
} from '@/lib/api'
import { formatBytes, formatDuration, relTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const TEMPLATES: { id: string; label: string; desc: string; build: (domain: string) => string }[] = [
  {
    id: 'fullstack-proxy',
    label: 'Proxy Reverso (App + API + WS)',
    desc: 'Frontend + Backend /api/ + suporte a WebSocket e cabeçalhos de segurança',
    build: (domain) => `# ${domain || 'meu-app.local'}

server {
    listen 80;
    server_name ${domain || 'meu-app.local'};

    # Headers de segurança
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Frontend / Aplicação Principal
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`,
  },
  {
    id: 'simple-proxy',
    label: 'Proxy Reverso Simples',
    desc: 'Encaminha todo o tráfego HTTP e WebSocket para uma porta local',
    build: (domain) => `server {
    listen 80;
    server_name ${domain || 'servico.local'};

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`,
  },
  {
    id: 'spa-static',
    label: 'Site Estático / SPA (React/Vite)',
    desc: 'Serve arquivos estáticos com fallback para index.html e cache de assets',
    build: (domain) => `server {
    listen 80;
    server_name ${domain || 'site.local'};

    root /var/www/${domain || 'site.local'}/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
`,
  },
]

export function NginxPanel() {
  const [data, setData] = useState<NginxOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [viewTab, setViewTab] = useState<'sites' | 'confd' | 'logs'>('sites')
  const [search, setSearch] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [lastTest, setLastTest] = useState<NginxTestResult | null>(null)
  const [sudoModalOpen, setSudoModalOpen] = useState(false)

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')
  const [editorScope, setEditorScope] = useState<NginxScope>('site')
  const [editorName, setEditorName] = useState('')
  const [editorPath, setEditorPath] = useState('')
  const [editorContent, setEditorContent] = useState('')
  const [editorEnable, setEditorEnable] = useState(true)
  const [editorReload, setEditorReload] = useState(true)
  const [editorBusy, setEditorBusy] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<NginxConfigItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  // Logs state
  const [logKind, setLogKind] = useState<'error' | 'access' | 'journal'>('error')
  const [logLinesCount, setLogLinesCount] = useState(120)
  const [logsData, setLogsData] = useState<NginxLogsResponse | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logFilter, setLogFilter] = useState('')

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const res = await api.nginxOverview()
      setData(res)
    } catch (e) {
      if (!silent) toast.error(String((e as Error).message || e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadLogs = useCallback(
    async (kind = logKind, lines = logLinesCount) => {
      setLogsLoading(true)
      try {
        const res = await api.nginxLogs(kind, lines)
        setLogsData(res)
      } catch (e) {
        toast.error(String((e as Error).message || e))
      } finally {
        setLogsLoading(false)
      }
    },
    [logKind, logLinesCount],
  )

  useEffect(() => {
    loadOverview()
    const timer = setInterval(() => loadOverview(true), 5000)
    return () => clearInterval(timer)
  }, [loadOverview])

  useEffect(() => {
    if (viewTab === 'logs') {
      loadLogs(logKind, logLinesCount)
    }
  }, [viewTab, logKind, logLinesCount, loadLogs])

  async function handleTestConfig() {
    setBusyAction('test')
    try {
      const res = await api.nginxTest()
      setLastTest(res)
      if (res.ok) {
        toast.success('nginx -t: sintaxe válida e configuração OK!')
      } else {
        toast.error('nginx -t encontrou problemas na configuração.')
      }
    } catch (e) {
      toast.error(String((e as Error).message || e))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleServiceAction(action: 'start' | 'stop' | 'restart' | 'reload') {
    setBusyAction(action)
    try {
      const res = await api.nginxAction(action)
      if (res.overview) setData(res.overview)
      if (res.ok) {
        toast.success(`Nginx: ${action.toUpperCase()} executado com sucesso!`)
      } else {
        toast.error(res.output || `Falha ao executar ${action}`)
      }
      if (res.output) {
        setLastTest({
          ok: res.ok,
          code: res.ok ? 0 : 1,
          output: res.output,
          durationMs: res.durationMs,
          usedSudo: true,
        })
      }
    } catch (e) {
      const msg = String((e as Error).message || e)
      toast.error(msg)
      if (msg.toLowerCase().includes('sudo')) setSudoModalOpen(true)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleToggleSite(item: NginxConfigItem) {
    const nextState = !item.enabled
    setBusyAction(`toggle:${item.name}`)
    try {
      const res = await api.nginxToggleSite({
        name: item.name,
        scope: item.scope,
        enabled: nextState,
        reloadAfter: true,
      })
      setData(res.overview)
      setLastTest(res.testResult)
      if (res.testResult.ok) {
        toast.success(
          `Site "${item.name}" ${nextState ? 'ativado' : 'desativado'}${
            res.reloadResult?.ok ? ' e Nginx recarregado!' : '.'
          }`,
        )
      } else {
        toast.warning(`Site alternado, mas "nginx -t" reportou alerta. Verifique o console de saída.`)
      }
    } catch (e) {
      const msg = String((e as Error).message || e)
      toast.error(msg)
      if (msg.toLowerCase().includes('sudo')) setSudoModalOpen(true)
    } finally {
      setBusyAction(null)
    }
  }

  function openCreateModal(scope: NginxScope = 'site') {
    const defaultDomain = scope === 'conf.d' ? 'custom-settings.conf' : 'novo-servico.local'
    setEditorMode('create')
    setEditorScope(scope)
    setEditorName(defaultDomain)
    setEditorPath(scope === 'conf.d' ? `/etc/nginx/conf.d/${defaultDomain}` : `/etc/nginx/sites-available/${defaultDomain}`)
    setEditorContent(
      scope === 'conf.d'
        ? `# Configurações globais HTTP adicionais (/etc/nginx/conf.d)\n\n# client_max_body_size 50M;\n`
        : TEMPLATES[0].build(defaultDomain),
    )
    setEditorEnable(true)
    setEditorReload(true)
    setEditorError(null)
    setEditorOpen(true)
  }

  async function openEditModal(name: string, scope: NginxScope) {
    setBusyAction(`edit:${name}`)
    setEditorError(null)
    try {
      const file = await api.nginxReadFile(name, scope)
      setEditorMode('edit')
      setEditorScope(scope)
      setEditorName(file.name)
      setEditorPath(file.path)
      setEditorContent(file.content)
      setEditorEnable(true)
      setEditorReload(true)
      setEditorOpen(true)
    } catch (e) {
      toast.error(String((e as Error).message || e))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveConfig() {
    if (!editorName.trim()) {
      setEditorError('Informe o nome do arquivo.')
      return
    }
    if (!editorContent.trim()) {
      setEditorError('O conteúdo da configuração não pode ficar vazio.')
      return
    }
    setEditorBusy(true)
    setEditorError(null)
    try {
      const res = await api.nginxSaveSite({
        name: editorName.trim(),
        scope: editorScope,
        content: editorContent,
        enable: editorEnable,
        reloadAfter: editorReload,
      })
      setData(res.overview)
      setLastTest(res.testResult)
      if (res.testResult.ok) {
        toast.success(
          `Configuração "${editorName.trim()}" salva${
            res.reloadResult?.ok ? ' e aplicada (reload) com sucesso!' : '!'
          }`,
        )
        setEditorOpen(false)
      } else {
        setEditorError(
          `Arquivo salvo, mas "nginx -t" falhou (o reload não foi aplicado para proteger o servidor):\n${res.testResult.output}`,
        )
      }
    } catch (e) {
      const msg = String((e as Error).message || e)
      setEditorError(msg)
      if (msg.toLowerCase().includes('sudo')) setSudoModalOpen(true)
    } finally {
      setEditorBusy(false)
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      const res = await api.nginxDeleteSite({
        name: deleteTarget.name,
        scope: deleteTarget.scope,
        reloadAfter: true,
      })
      setData(res.overview)
      setLastTest(res.testResult)
      toast.success(`Configuração "${deleteTarget.name}" removida.`)
      setDeleteTarget(null)
    } catch (e) {
      toast.error(String((e as Error).message || e))
    } finally {
      setDeleteBusy(false)
    }
  }

  const filteredSites = useMemo(() => {
    const list = data?.sites ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.serverNames.some((n) => n.toLowerCase().includes(q)) ||
        s.upstreams.some((u) => u.target.toLowerCase().includes(q) || u.location.toLowerCase().includes(q)) ||
        (s.description && s.description.toLowerCase().includes(q)),
    )
  }, [data?.sites, search])

  const filteredLogs = useMemo(() => {
    const lines = logsData?.lines ?? []
    const q = logFilter.trim().toLowerCase()
    if (!q) return lines
    return lines.filter((l) => l.toLowerCase().includes(q))
  }, [logsData?.lines, logFilter])

  const stats = useMemo(() => {
    const sites = data?.sites ?? []
    const enabledCount = sites.filter((s) => s.enabled).length
    const totalUpstreams = sites.reduce((acc, s) => acc + s.upstreams.length, 0)
    const ports = Array.from(new Set(sites.filter((s) => s.enabled).flatMap((s) => s.listenPorts)))
    return {
      totalSites: sites.length,
      enabledCount,
      totalUpstreams,
      ports,
    }
  }, [data?.sites])

  if (loading && !data) {
    return (
      <Card className="p-8 text-center font-mono text-xs text-muted-foreground">
        <Loader2 className="mx-auto mb-2 size-5 animate-spin text-cyan-400" />
        Carregando gerenciador de Nginx da máquina…
      </Card>
    )
  }

  const svc = data?.service
  const sudo = data?.sudo

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Serviço Nginx"
          value={svc?.active ? 'ONLINE' : 'PARADO'}
          accent={svc?.active ? 'text-emerald-400' : 'text-rose-400'}
          icon={<Globe className="size-4 text-emerald-400" />}
          hint={
            svc?.active
              ? `PID ${svc.masterPid ?? '—'} · ${svc.workerCount} workers · up ${
                  svc.uptimeSec ? formatDuration(svc.uptimeSec) : '—'
                }`
              : `Estado: ${svc?.subState || 'inativo'}`
          }
        >
          <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <Badge variant="outline" className="border-cyan-500/25 bg-cyan-500/10 text-[10px] text-cyan-300">
              v{data?.version || '1.x'}
            </Badge>
            <span>RAM: {formatBytes(svc?.memoryBytes ?? 0, 1)}</span>
            <span>·</span>
            <span>CPU: {svc?.cpuPct ?? 0}%</span>
          </div>
        </StatCard>

        <StatCard
          label="Virtual Hosts (Sites)"
          value={`${stats.enabledCount} / ${stats.totalSites}`}
          accent="text-cyan-300"
          icon={<Server className="size-4 text-cyan-400" />}
          hint={`${stats.enabledCount} ativo(s) em sites-enabled · ${data?.confd.length ?? 0} em conf.d`}
        >
          <div className="mt-2 flex flex-wrap gap-1">
            {stats.ports.length > 0 ? (
              stats.ports.slice(0, 4).map((p) => (
                <Badge key={p} variant="secondary" className="font-mono text-[10px]">
                  listen :{p}
                </Badge>
              ))
            ) : (
              <span className="font-mono text-[11px] text-muted-foreground">Nenhuma porta detectada</span>
            )}
          </div>
        </StatCard>

        <StatCard
          label="Rotas Proxy Reverso"
          value={stats.totalUpstreams}
          accent="text-violet-300"
          icon={<Waypoints className="size-4 text-violet-400" />}
          hint="Mapeamentos location → proxy_pass"
        >
          <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
            /etc/nginx/sites-available & sites-enabled
          </div>
        </StatCard>

        <StatCard
          label="Privilégios Sudo (Host)"
          value={sudo?.canSudo ? 'AUTORIZADO' : 'REQUER SENHA'}
          accent={sudo?.canSudo ? 'text-emerald-300' : 'text-amber-300'}
          icon={
            sudo?.canSudo ? (
              <ShieldCheck className="size-4 text-emerald-400" />
            ) : (
              <ShieldAlert className="size-4 text-amber-400" />
            )
          }
          hint={
            sudo?.canSudo
              ? `Usuário ${sudo.configuredUser} (${sudo.method})`
              : 'Necessário para reload/restart e nginx -t'
          }
        >
          <div className="mt-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() => setSudoModalOpen(true)}
              className="font-mono text-[11px]"
            >
              <KeyRound className="size-3 text-cyan-400" />
              {sudo?.canSudo ? 'Gerenciar Cofre Sudo' : 'Configurar Sudo'}
            </Button>
          </div>
        </StatCard>
      </div>

      {/* Painel de Controle Rápido do Serviço + Saída do nginx -t */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Terminal className="size-4 text-cyan-400" /> Controle do Daemon Nginx & Validação de Sintaxe
              </CardTitle>
              <CardDescription className="text-xs">
                Teste a configuração com <code className="font-mono text-foreground">nginx -t</code> antes de recarregar
                ou gerencie os sites e arquivos de configuração da máquina.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busyAction !== null}
                onClick={handleTestConfig}
                className="border-cyan-500/30 font-mono text-xs"
              >
                {busyAction === 'test' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CircleCheckIcon className="size-3.5 text-cyan-400" />
                )}
                Testar (nginx -t)
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busyAction !== null || !svc?.active}
                onClick={() => handleServiceAction('reload')}
                className="border-emerald-500/30 font-mono text-xs text-emerald-300 hover:bg-emerald-500/15"
              >
                {busyAction === 'reload' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Reload
              </Button>

              <Button
                size="sm"
                variant="outline"
                disabled={busyAction !== null}
                onClick={() => handleServiceAction('restart')}
                className="font-mono text-xs"
              >
                {busyAction === 'restart' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCw className="size-3.5 text-amber-400" />
                )}
                Restart
              </Button>

              {svc?.active ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyAction !== null}
                  onClick={() => handleServiceAction('stop')}
                  className="font-mono text-xs"
                >
                  {busyAction === 'stop' ? <Loader2 className="size-3.5 animate-spin" /> : <Pause className="size-3.5" />}
                  Parar
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="default"
                  disabled={busyAction !== null}
                  onClick={() => handleServiceAction('start')}
                  className="font-mono text-xs"
                >
                  {busyAction === 'start' ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  Iniciar
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                disabled={busyAction !== null}
                onClick={() => openEditModal('nginx.conf', 'main')}
                className="font-mono text-xs"
              >
                <File className="size-3.5 text-violet-400" /> nginx.conf
              </Button>

              <Button
                size="sm"
                variant="default"
                onClick={() => openCreateModal('site')}
                className="font-mono text-xs"
              >
                <Plus className="size-3.5" /> Novo Site
              </Button>
            </div>
          </div>
        </CardHeader>

        {lastTest && (
          <CardContent className="pt-0">
            <div
              className={cn(
                'relative rounded-lg border p-3 font-mono text-xs',
                lastTest.ok
                  ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                  : 'border-rose-500/40 bg-rose-950/25 text-rose-200',
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold">
                  {lastTest.ok ? (
                    <Check className="size-3.5 text-emerald-400" />
                  ) : (
                    <TriangleAlert className="size-3.5 text-rose-400" />
                  )}
                  Resultado de validação ({lastTest.durationMs}ms)
                </span>
                <button
                  type="button"
                  onClick={() => setLastTest(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed opacity-90">
                {lastTest.output}
              </pre>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Sub-navegação: Sites vs conf.d vs Logs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-cyan-500/15 bg-card/80 p-1 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setViewTab('sites')}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors',
              viewTab === 'sites'
                ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Globe className="size-3.5" />
            Sites & Virtual Hosts ({data?.sites.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('confd')}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors',
              viewTab === 'confd'
                ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Layers className="size-3.5" />
            conf.d & Global ({data?.confd.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setViewTab('logs')}
            className={cn(
              'flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors',
              viewTab === 'logs'
                ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ScrollText className="size-3.5" />
            Logs (Access / Error)
          </button>
        </div>

        {viewTab === 'sites' && (
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar domínio, porta, upstream…"
                className="h-8 pl-8 font-mono text-xs"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadOverview()}
              disabled={refreshing}
              className="font-mono text-xs"
            >
              <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
            </Button>
          </div>
        )}
      </div>

      {/* ABA 1: SITES (sites-available & sites-enabled) */}
      {viewTab === 'sites' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredSites.map((site) => {
            const isToggling = busyAction === `toggle:${site.name}`
            const isEditing = busyAction === `edit:${site.name}`
            return (
              <Card
                key={site.name}
                className={cn(
                  'transition-all',
                  site.enabled ? 'ring-cyan-500/20' : 'opacity-75 hover:opacity-100',
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-sm font-semibold">
                        <span className="truncate">{site.name}</span>
                        {site.enabled ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300"
                          >
                            <span className="mr-1 size-1.5 rounded-full bg-emerald-400" />
                            ATIVO
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px] text-muted-foreground">
                            INATIVO
                          </Badge>
                        )}
                        {site.ssl && (
                          <Badge
                            variant="outline"
                            className="border-cyan-400/30 bg-cyan-500/10 text-[10px] text-cyan-300"
                          >
                            <Lock className="mr-1 size-2.5" /> SSL/TLS
                          </Badge>
                        )}
                        {site.isSymlink ? (
                          <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                            <Link2 className="mr-1 size-2.5" /> symlink
                          </Badge>
                        ) : site.inEnabled ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/30 bg-amber-500/10 font-mono text-[10px] text-amber-300"
                            title="Arquivo direto em sites-enabled (ao desativar será preservado em sites-available)"
                          >
                            arquivo direto
                          </Badge>
                        ) : null}
                        {site.diverged && (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 bg-amber-500/15 font-mono text-[10px] text-amber-300"
                            title="Existem arquivos separados em sites-available e sites-enabled com conteúdos diferentes. Ao salvar no editor, ambos serão sincronizados."
                          >
                            <TriangleAlert className="mr-1 size-2.5" /> divergente
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-0.5 font-mono text-[11px]">
                        {site.description || site.path} · {formatBytes(site.size, 0)} · atualizado{' '}
                        {relTime(site.mtime)}
                      </CardDescription>
                    </div>

                    <CardAction className="flex items-center gap-1.5">
                      <Button
                        size="xs"
                        variant={site.enabled ? 'outline' : 'default'}
                        disabled={busyAction !== null}
                        onClick={() => handleToggleSite(site)}
                        className="font-mono text-[11px]"
                      >
                        {isToggling ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : site.enabled ? (
                          'Desativar'
                        ) : (
                          'Ativar'
                        )}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busyAction !== null}
                        onClick={() => openEditModal(site.name, 'site')}
                        className="font-mono text-[11px]"
                      >
                        {isEditing ? <Loader2 className="size-3 animate-spin" /> : <Pencil className="size-3" />}
                        Editar
                      </Button>
                      {site.name !== 'default' && (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          disabled={busyAction !== null}
                          onClick={() => setDeleteTarget(site)}
                          className="text-rose-400 hover:bg-rose-500/15 hover:text-rose-300"
                          title="Excluir site"
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      )}
                    </CardAction>
                  </div>
                </CardHeader>

                <CardContent className="space-y-2.5 pt-1 text-xs">
                  {/* Server Names & Listen Ports */}
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-background/50 px-2.5 py-2 font-mono text-[11px]">
                    <span className="text-muted-foreground">server_name:</span>
                    {site.serverNames.length > 0 ? (
                      site.serverNames.map((sn) => (
                        <span key={sn} className="font-semibold text-cyan-300">
                          {sn}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">_</span>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-1">
                      {site.listenPorts.map((lp) => (
                        <Badge key={lp} variant="secondary" className="font-mono text-[10px]">
                          listen {lp}
                        </Badge>
                      ))}
                    </span>
                  </div>

                  {/* Upstreams / Proxy Pass */}
                  {site.upstreams.length > 0 && (
                    <div className="space-y-1">
                      <div className="font-mono text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                        Rotas Proxy Pass ({site.upstreams.length})
                      </div>
                      <div className="grid gap-1">
                        {site.upstreams.map((u, idx) => (
                          <div
                            key={`${u.location}-${idx}`}
                            className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1 font-mono text-[11px]"
                          >
                            <span className="truncate font-medium text-foreground">{u.location}</span>
                            <span className="text-muted-foreground">→</span>
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-emerald-300">{u.target}</span>
                              {u.websocket && (
                                <Badge
                                  variant="outline"
                                  className="border-violet-400/30 bg-violet-500/10 px-1 py-0 text-[9px] text-violet-300"
                                >
                                  WS
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Roots & Rate Limits */}
                  {(site.roots.length > 0 || site.rateLimits.length > 0) && (
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      {site.roots.map((r) => (
                        <span
                          key={r}
                          className="rounded border border-border/60 bg-background/40 px-2 py-0.5 text-[10px]"
                        >
                          root: <strong className="text-foreground">{r}</strong>
                        </span>
                      ))}
                      {site.rateLimits.map((rl) => (
                        <span
                          key={rl}
                          className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300"
                        >
                          limit_req: {rl}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}

          {filteredSites.length === 0 && (
            <Card className="col-span-full p-8 text-center font-mono text-xs text-muted-foreground">
              Nenhum site encontrado para o filtro informado.
            </Card>
          )}
        </div>
      )}

      {/* ABA 2: CONF.D & ARQUIVO PRINCIPAL */}
      {viewTab === 'confd' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-muted-foreground">
              Arquivos em <code className="text-foreground">/etc/nginx/conf.d/*.conf</code> são carregados globalmente
              no bloco <code className="text-foreground">http</code> (ideais para zonas de rate-limit, gzip, upstreams
              globais e timeouts).
            </p>
            <Button size="sm" onClick={() => openCreateModal('conf.d')} className="font-mono text-xs">
              <Plus className="size-3.5" /> Novo em conf.d
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {data?.mainConfig && (
              <Card className="border-violet-500/25">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 font-mono text-sm">
                        <File className="size-4 text-violet-400" /> /etc/nginx/nginx.conf
                        <Badge variant="outline" className="border-violet-400/30 bg-violet-500/10 text-[10px] text-violet-300">
                          PRINCIPAL
                        </Badge>
                      </CardTitle>
                      <CardDescription className="mt-0.5 font-mono text-[11px]">
                        Configuração mestre do daemon · {formatBytes(data.mainConfig.size, 0)} · atualizado{' '}
                        {relTime(data.mainConfig.mtime)}
                      </CardDescription>
                    </div>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => openEditModal('nginx.conf', 'main')}
                      className="font-mono text-[11px]"
                    >
                      <Pencil className="size-3" /> Editar
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            )}

            {(data?.confd ?? []).map((item) => (
              <Card key={item.name}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 font-mono text-sm">
                        <span>{item.name}</span>
                        {item.enabled ? (
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">
                            ATIVO
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            DESATIVADO
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="mt-0.5 font-mono text-[11px]">
                        {item.description || item.path} · {formatBytes(item.size, 0)}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => handleToggleSite(item)}
                        className="font-mono text-[11px]"
                      >
                        {item.enabled ? 'Desativar' : 'Ativar'}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => openEditModal(item.name, 'conf.d')}
                        className="font-mono text-[11px]"
                      >
                        <Pencil className="size-3" /> Editar
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => setDeleteTarget(item)}
                        className="text-rose-400 hover:bg-rose-500/15"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {item.rateLimits.length > 0 && (
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
                      {item.rateLimits.map((rl) => (
                        <span
                          key={rl}
                          className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300"
                        >
                          {rl}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* ABA 3: LOGS DO NGINX */}
      {viewTab === 'logs' && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ScrollText className="size-4 text-cyan-400" /> Logs do Nginx
                </CardTitle>
                <CardDescription className="font-mono text-xs">
                  Fonte: {logsData?.source || '/var/log/nginx'} ({filteredLogs.length} linhas exibidas)
                </CardDescription>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-border bg-background/60 p-0.5 font-mono text-xs">
                  {(['error', 'access', 'journal'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setLogKind(k)}
                      className={cn(
                        'rounded-md px-2.5 py-1 transition-colors',
                        logKind === k ? 'bg-cyan-500/20 text-cyan-200 font-semibold' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {k === 'error' ? 'error.log' : k === 'access' ? 'access.log' : 'journalctl'}
                    </button>
                  ))}
                </div>

                <select
                  value={logLinesCount}
                  onChange={(e) => setLogLinesCount(Number(e.target.value))}
                  className="h-8 rounded-lg border border-input bg-background px-2 font-mono text-xs"
                >
                  <option value={80}>80 linhas</option>
                  <option value={150}>150 linhas</option>
                  <option value={300}>300 linhas</option>
                </select>

                <Input
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  placeholder="Filtrar nos logs (IP, 502, 404…)"
                  className="h-8 w-52 font-mono text-xs"
                />

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => loadLogs(logKind, logLinesCount)}
                  disabled={logsLoading}
                  className="font-mono text-xs"
                >
                  <RefreshCw className={cn('size-3.5', logsLoading && 'animate-spin')} /> Atualizar
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(filteredLogs.join('\n'))
                    toast.success('Logs copiados para a área de transferência!')
                  }}
                  className="font-mono text-xs"
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            {logsData?.error && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-amber-500/35 bg-amber-950/20 px-3 py-2 font-mono text-xs text-amber-200">
                <span>{logsData.error}</span>
                <Button size="xs" variant="outline" onClick={() => setSudoModalOpen(true)}>
                  Abrir Cofre Sudo
                </Button>
              </div>
            )}

            <div className="max-h-[460px] overflow-auto rounded-lg border border-border bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed">
              {filteredLogs.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  {logsLoading ? 'Carregando linhas de log…' : 'Nenhuma linha encontrada.'}
                </div>
              ) : (
                filteredLogs.map((line, idx) => {
                  const isErr = /\[error\]|\[crit\]|\[alert\]|\b50[0234]\b/i.test(line)
                  const isWarn = /\[warn\]|\b40[0134]\b|\b429\b/i.test(line)
                  return (
                    <div
                      key={idx}
                      className={cn(
                        'border-b border-white/5 py-0.5 break-all',
                        isErr ? 'text-rose-300' : isWarn ? 'text-amber-300' : 'text-foreground/85',
                      )}
                    >
                      <span className="mr-2 select-none text-muted-foreground/50">
                        {String(idx + 1).padStart(3, '0')}
                      </span>
                      {line}
                    </div>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* MODAL EDITOR DE CONFIGURAÇÃO / NOVO SITE */}
      <AlertDialog open={editorOpen} onOpenChange={setEditorOpen}>
        <AlertDialogContent className="sm:max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 font-mono text-base">
              <File className="size-4 text-cyan-400" />
              {editorMode === 'create'
                ? editorScope === 'conf.d'
                  ? 'Nova Configuração em /etc/nginx/conf.d'
                  : 'Novo Virtual Host (Site Nginx)'
                : `Editar ${editorPath}`}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Ao salvar, o gerenciador executa <code className="font-mono text-foreground">nginx -t</code>{' '}
              automaticamente. O reload só é aplicado se a sintaxe estiver 100% válida.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-1">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[220px] flex-1">
                <label className="mb-1 block font-mono text-[11px] text-muted-foreground">
                  Nome do Arquivo ({editorScope === 'conf.d' ? '/etc/nginx/conf.d/' : '/etc/nginx/sites-available/'})
                </label>
                <Input
                  value={editorName}
                  disabled={editorMode === 'edit'}
                  onChange={(e) => setEditorName(e.target.value)}
                  placeholder="ex: meu-sistema.local"
                  className="font-mono text-xs"
                />
              </div>

              {editorMode === 'create' && editorScope === 'site' && (
                <div>
                  <label className="mb-1 block font-mono text-[11px] text-muted-foreground">
                    Aplicar Template Rápido
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {TEMPLATES.map((tpl) => (
                      <Button
                        key={tpl.id}
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => setEditorContent(tpl.build(editorName.trim() || 'meu-app.local'))}
                        title={tpl.desc}
                        className="font-mono text-[11px]"
                      >
                        <Sparkles className="size-3 text-cyan-400" />
                        {tpl.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                <span>Conteúdo da Configuração (Nginx Directive Syntax)</span>
                <span>{editorContent.split('\n').length} linhas</span>
              </div>
              <textarea
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                rows={16}
                spellCheck={false}
                className="w-full rounded-lg border border-input bg-slate-950/85 p-3 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>

            <div className="flex flex-wrap items-center gap-5 pt-1">
              {editorMode === 'create' && editorScope === 'site' && (
                <label className="flex cursor-pointer items-center gap-2 font-mono text-xs">
                  <Checkbox checked={editorEnable} onCheckedChange={(v) => setEditorEnable(Boolean(v))} />
                  <span>Ativar imediatamente em sites-enabled (criar symlink)</span>
                </label>
              )}

              <label className="flex cursor-pointer items-center gap-2 font-mono text-xs">
                <Checkbox checked={editorReload} onCheckedChange={(v) => setEditorReload(Boolean(v))} />
                <span>Executar systemctl reload nginx após validar com nginx -t</span>
              </label>
            </div>

            {editorError && (
              <pre className="max-h-36 overflow-auto rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 font-mono text-[11px] whitespace-pre-wrap text-rose-200">
                {editorError}
              </pre>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={editorBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={editorBusy}
              onClick={(e) => {
                e.preventDefault()
                handleSaveConfig()
              }}
            >
              {editorBusy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Salvar & Validar (nginx -t)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* MODAL CONFIRMAR EXCLUSÃO */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-400">
              <Trash2 className="size-4" /> Excluir configuração "{deleteTarget?.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá o arquivo de configuração ({deleteTarget?.path}) e seu link em{' '}
              <code className="font-mono">sites-enabled</code>, seguido de validação <code className="font-mono">nginx -t</code> e reload.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                handleConfirmDelete()
              }}
            >
              {deleteBusy ? <Loader2 className="size-4 animate-spin" /> : null} Excluir Definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* MODAL SUDO */}
      <SudoConfigModal
        open={sudoModalOpen}
        onOpenChange={setSudoModalOpen}
        defaultUser={sudo?.configuredUser || 'raony'}
        humanUsers={sudo?.humanUsers || []}
        hasSavedPassword={Boolean(sudo?.hasSavedPassword)}
        onSaved={() => loadOverview()}
      />
    </div>
  )
}
