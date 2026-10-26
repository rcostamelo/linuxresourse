import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  Check,
  Database,
  File,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  MemoryStick,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  ScrollText,
  Search,
  Server,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  User,
  Zap,
} from '@/components/ui/lucide-animated'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { TelemetryLoader } from '@/components/ui/telemetry-loader'
import { api } from '@/lib/api'
import type {
  ProcManagedProcess,
  ProcManagerDaemon,
  ProcManagerEngine,
  ProcManagerLogsResponse,
  ProcManagersOverview,
} from '@/lib/api'
import { formatBytes, formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

export function ProcManagersPanel() {
  const [overview, setOverview] = useState<ProcManagersOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState(null as string | null)

  // Filtros
  const [engineFilter, setEngineFilter] = useState<'all' | ProcManagerEngine>('all')
  const [ownerFilter, setOwnerFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'stopped' | 'saved'>('all')
  const [search, setSearch] = useState('')

  // Modal de Logs
  const [logTarget, setLogTarget] = useState<ProcManagedProcess | null>(null)
  const [logData, setLogData] = useState<ProcManagerLogsResponse | null>(null)
  const [logTab, setLogTab] = useState<'out' | 'err'>('out')
  const [logLines, setLogLines] = useState(150)
  const [logFilter, setLogFilter] = useState('')
  const [loadingLogs, setLoadingLogs] = useState(false)

  // Modal de Escalar (Cluster)
  const [scaleTarget, setScaleTarget] = useState<ProcManagedProcess | null>(null)
  const [scaleInstances, setScaleInstances] = useState('2')

  // Modal de Novo Processo
  const [startOpen, setStartOpen] = useState(false)
  const [startEngine, setStartEngine] = useState<ProcManagerEngine>('procman')
  const [startOwner, setStartOwner] = useState('')
  const [startScript, setStartScript] = useState('')
  const [startName, setStartName] = useState('')
  const [startNamespace, setStartNamespace] = useState('default')
  const [startCwd, setStartCwd] = useState('')
  const [startMode, setStartMode] = useState<'fork' | 'cluster'>('fork')
  const [startInstances, setStartInstances] = useState('')
  const [startMaxMem, setStartMaxMem] = useState('')
  const [startCron, setStartCron] = useState('')
  const [startWatch, setStartWatch] = useState(false)
  const [startArgs, setStartArgs] = useState('')
  const [startingApp, setStartingApp] = useState(false)

  // Modal Cofre Sudo
  const [sudoOpen, setSudoOpen] = useState(false)
  const [sudoUser, setSudoUser] = useState('')
  const [sudoPass, setSudoPass] = useState('')
  const [savingSudo, setSavingSudo] = useState(false)

  const loadOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.procManagersOverview()
      setOverview(data)
      if (!sudoUser && data.sudo?.configuredUser) {
        setSudoUser(data.sudo.configuredUser)
      }
      if (!startOwner && data.runtimes.users.length > 0) {
        const preferred =
          data.runtimes.users.find((u) => u.uid === 1000) || data.runtimes.users[0]
        setStartOwner(preferred.username)
      }
    } catch (e: unknown) {
      if (!silent) {
        toast.error(e instanceof Error ? e.message : 'Erro ao carregar gerenciadores procman/PM2')
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [sudoUser, startOwner])

  useEffect(() => {
    loadOverview(false)
    const id = setInterval(() => loadOverview(true), 4000)
    return () => clearInterval(id)
  }, [loadOverview])

  const loadProcessLogs = useCallback(
    async (proc: ProcManagedProcess, lines = logLines) => {
      setLoadingLogs(true)
      try {
        const res = await api.procManagerLogs({
          engine: proc.engine,
          owner: proc.owner,
          outLog: proc.outLog,
          errLog: proc.errLog,
          lines,
        })
        setLogData(res)
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Falha ao ler arquivos de log')
      } finally {
        setLoadingLogs(false)
      }
    },
    [logLines],
  )

  useEffect(() => {
    if (logTarget) {
      loadProcessLogs(logTarget, logLines)
    }
  }, [logTarget, logLines, loadProcessLogs])

  const handleAction = async (
    engine: ProcManagerEngine,
    owner: string,
    action: 'restart' | 'reload' | 'stop' | 'delete' | 'scale' | 'save' | 'resurrect' | 'kill-daemon',
    target?: string,
    instances?: number,
  ) => {
    const key = `${engine}:${owner}:${action}:${target ?? ''}`
    setBusyKey(key)
    try {
      const res = await api.procManagerAction({
        engine,
        owner,
        action,
        target,
        instances,
      })
      setOverview(res.overview)
      toast.success(res.output || `Ação ${action} concluída`)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : `Falha ao executar ${action}`)
    } finally {
      setBusyKey(null)
    }
  }

  const handleStartApp = async () => {
    if (!startScript.trim()) {
      toast.error('Informe o caminho do script ou ecosystem.config.js')
      return
    }
    setStartingApp(true)
    try {
      const res = await api.procManagerStart({
        engine: startEngine,
        owner: startOwner,
        script: startScript.trim(),
        name: startName.trim() || undefined,
        namespace: startNamespace.trim() || undefined,
        cwd: startCwd.trim() || undefined,
        mode: startMode,
        instances: startInstances.trim() || undefined,
        maxMemoryRestart: startMaxMem.trim() || undefined,
        cron: startCron.trim() || undefined,
        watch: startWatch,
        args: startArgs.trim() || undefined,
      })
      setOverview(res.overview)
      toast.success(`Processo iniciado em ${startEngine} (@${startOwner})`)
      setStartOpen(false)
      setStartScript('')
      setStartName('')
      setStartArgs('')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar processo')
    } finally {
      setStartingApp(false)
    }
  }

  const handleInstallProcmand = async () => {
    setBusyKey('install-procmand')
    try {
      const res = await api.procManagerInstall(startOwner || undefined)
      setOverview(res.overview)
      toast.success('procmand instalado globalmente com sucesso!')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao instalar procmand')
    } finally {
      setBusyKey(null)
    }
  }

  const handleSaveSudo = async () => {
    if (!sudoUser.trim() || !sudoPass) {
      toast.error('Informe o usuário e a senha sudo.')
      return
    }
    setSavingSudo(true)
    try {
      await api.osConfigureSudo(sudoUser.trim(), sudoPass)
      setSudoPass('')
      setSudoOpen(false)
      toast.success('Credencial sudo validada e salva no cofre!')
      await loadOverview(true)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao validar sudo')
    } finally {
      setSavingSudo(false)
    }
  }

  const allOwners = useMemo(() => {
    const s = new Set<string>()
    for (const d of overview?.daemons ?? []) s.add(d.owner)
    for (const p of overview?.processes ?? []) s.add(p.owner)
    return Array.from(s).sort()
  }, [overview])

  const filteredProcesses = useMemo(() => {
    const list = overview?.processes ?? []
    const q = search.trim().toLowerCase()
    return list.filter((p) => {
      if (engineFilter !== 'all' && p.engine !== engineFilter) return false
      if (ownerFilter !== 'all' && p.owner !== ownerFilter) return false
      if (statusFilter === 'online' && p.status !== 'online') return false
      if (statusFilter === 'stopped' && p.status === 'online') return false
      if (statusFilter === 'saved' && !p.savedOnly) return false
      if (!q) return true
      return [
        p.name,
        p.namespace,
        p.owner,
        p.engine,
        p.script,
        p.cwd,
        String(p.pid),
        p.ports.join(','),
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [overview, engineFilter, ownerFilter, statusFilter, search])

  const stats = useMemo(() => {
    const procs = overview?.processes ?? []
    const online = procs.filter((p) => p.status === 'online')
    const procmanCount = procs.filter((p) => p.engine === 'procman').length
    const pm2Count = procs.filter((p) => p.engine === 'pm2').length
    const totalCpu = online.reduce((acc, p) => acc + (p.cpu || 0), 0)
    const totalMem = online.reduce((acc, p) => acc + (p.memory || 0), 0)
    const activeDaemons = (overview?.daemons ?? []).filter((d) => d.running).length
    return {
      total: procs.length,
      onlineCount: online.length,
      procmanCount,
      pm2Count,
      totalCpu,
      totalMem,
      activeDaemons,
      totalDaemons: (overview?.daemons ?? []).length,
    }
  }, [overview])

  const visibleLogLines = useMemo(() => {
    const raw = logTab === 'out' ? logData?.outLines ?? [] : logData?.errLines ?? []
    const q = logFilter.trim().toLowerCase()
    if (!q) return raw
    return raw.filter((l) => l.toLowerCase().includes(q))
  }, [logData, logTab, logFilter])

  if (loading && !overview) {
    return <TelemetryLoader variant="docker" labelOverride="Varrendo daemons procman e PM2 de todos os usuários do sistema…" />
  }

  const hostIp = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1'

  return (
    <div className="space-y-4">
      {/* KPIs de Topo */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Processos Gerenciados"
          value={`${stats.onlineCount} / ${stats.total}`}
          hint={`${stats.procmanCount} no procman · ${stats.pm2Count} no PM2`}
          icon={<Layers className="size-4 text-cyan-400" />}
        />
        <StatCard
          label="Daemons por Usuário"
          value={`${stats.activeDaemons} ativos (${stats.totalDaemons} total)`}
          hint={
            allOwners.length > 0
              ? `Usuários: ${allOwners.join(', ')}`
              : 'Nenhum diretório .procman/.pm2 ativo'
          }
          icon={<User className="size-4 text-emerald-400" />}
        />
        <StatCard
          label="Consumo Node (Runtimes)"
          value={formatBytes(stats.totalMem, 1)}
          hint={`CPU agregada: ${stats.totalCpu.toFixed(1)}%`}
          icon={<MemoryStick className="size-4 text-violet-400" />}
        />
        <StatCard
          label="Runtimes & Elevação"
          value={
            overview?.runtimes.procmanInstalled && overview?.runtimes.pm2Installed
              ? 'procman + PM2'
              : overview?.runtimes.procmanInstalled
                ? 'procman ativo'
                : overview?.runtimes.pm2Installed
                  ? 'PM2 ativo'
                  : 'Não detectado'
          }
          hint={
            overview?.sudo.canSudo
              ? `Visão multi-usuário ativa (${overview.sudo.configuredUser})`
              : 'Configure o Cofre Sudo para ações cross-user'
          }
          icon={<Zap className="size-4 text-amber-400" />}
        />
      </div>

      {/* Barra de Controle & Instalação */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Boxes className="size-4 text-cyan-400" />
                Plugin Multi-Usuário · procman & PM2
                <Badge variant="outline" className="font-mono text-[10px] text-cyan-300">
                  procmand + pm2
                </Badge>
              </CardTitle>
              <CardDescription>
                Inspeciona e controla todos os processos e dumps (`.procman` e `.pm2`) iniciados por qualquer usuário do sistema operacional (`root`, `/home/*`).
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!overview?.runtimes.procmanInstalled && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyKey === 'install-procmand'}
                  onClick={handleInstallProcmand}
                  className="border-cyan-500/35 text-cyan-300"
                >
                  {busyKey === 'install-procmand' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  Instalar procmand (npm -g)
                </Button>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={() => setSudoOpen(true)}
                className={cn(
                  overview?.sudo.canSudo
                    ? 'border-emerald-500/30 text-emerald-300'
                    : 'border-amber-500/40 text-amber-300',
                )}
              >
                <KeyRound className="size-3.5" />
                {overview?.sudo.canSudo ? 'Cofre Sudo Ativo' : 'Configurar Cofre Sudo'}
              </Button>

              <Button size="sm" variant="outline" onClick={() => loadOverview(false)}>
                <RefreshCw className="size-3.5" />
                Atualizar
              </Button>

              <Button size="sm" onClick={() => setStartOpen(true)}>
                <Plus className="size-3.5" />
                Iniciar App / Ecosystem
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Daemons por Usuário */}
        {(overview?.daemons.length ?? 0) > 0 && (
          <CardContent className="border-t border-border/60 pt-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Daemons & Perfis de Usuários Descobertos no Host
              </span>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {overview?.daemons.map((d: ProcManagerDaemon) => {
                const isProcman = d.engine === 'procman'
                const resKey = `${d.engine}:${d.owner}:resurrect:`
                const saveKey = `${d.engine}:${d.owner}:save:`
                return (
                  <div
                    key={`${d.engine}:${d.owner}:${d.stateDir}`}
                    className="flex flex-col justify-between gap-2.5 rounded-xl border border-border/80 bg-background/55 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              'font-mono text-[10px] uppercase',
                              isProcman
                                ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300'
                                : 'border-violet-400/40 bg-violet-500/10 text-violet-300',
                            )}
                          >
                            {d.engine}
                          </Badge>
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            <User className="mr-1 size-2.5" />
                            {d.owner} (UID {d.ownerUid})
                          </Badge>
                          {d.version && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              v{d.version}
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                          title={d.stateDir}
                        >
                          {d.stateDir}
                        </div>
                      </div>

                      <Badge
                        variant="outline"
                        className={cn(
                          'shrink-0 font-mono text-[10px]',
                          d.running
                            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                        )}
                      >
                        {d.running ? `ONLINE · PID ${d.pid}` : 'PARADO (DUMP)'}
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2 text-xs">
                      <span className="font-mono text-[11px] text-muted-foreground">
                        <strong className="text-foreground">{d.onlineCount}</strong> online ·{' '}
                        <strong className="text-foreground">{d.savedCount}</strong> salvo(s) no dump
                      </span>

                      <div className="flex items-center gap-1.5">
                        {d.savedCount > 0 && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busyKey === resKey}
                            onClick={() => handleAction(d.engine, d.owner, 'resurrect')}
                            title="Restaurar todos os processos salvos (resurrect)"
                          >
                            {busyKey === resKey ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Play className="size-3 text-emerald-400" />
                            )}
                            Resurrect
                          </Button>
                        )}
                        {d.running && (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busyKey === saveKey}
                            onClick={() => handleAction(d.engine, d.owner, 'save')}
                            title="Salvar lista atual em dump (save)"
                          >
                            {busyKey === saveKey ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Database className="size-3 text-cyan-400" />
                            )}
                            Save
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Filtros e Lista de Processos */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Filtro por Engine */}
              {(['all', 'procman', 'pm2'] as const).map((eng) => (
                <Button
                  key={eng}
                  size="xs"
                  variant={engineFilter === eng ? 'default' : 'outline'}
                  onClick={() => setEngineFilter(eng)}
                  className="font-mono uppercase"
                >
                  {eng === 'all' ? 'Todos' : eng}
                </Button>
              ))}

              <span className="mx-1 h-4 w-px bg-border" />

              {/* Filtro por Usuário do Sistema */}
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground"
              >
                <option value="all">Usuário SO: Todos ({allOwners.length})</option>
                {allOwners.map((u) => (
                  <option key={u} value={u}>
                    @{u}
                  </option>
                ))}
              </select>

              {/* Filtro por Status */}
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'all' | 'online' | 'stopped' | 'saved')
                }
                className="h-7 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground"
              >
                <option value="all">Status: Todos</option>
                <option value="online">Somente Online</option>
                <option value="stopped">Parados / Com Erro</option>
                <option value="saved">Salvos em Dump (Resurrect)</option>
              </select>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar app, usuário, porta, script…"
                className="h-8 pl-8 text-xs"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {filteredProcesses.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
              <Server className="mb-2 size-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">Nenhum processo procman ou PM2 encontrado para este filtro</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Inicie um novo processo Node/script clicando em &ldquo;Iniciar App / Ecosystem&rdquo; ou restaure um dump salvo.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredProcesses.map((proc) => {
                const isOnline = proc.status === 'online'
                const isSaved = proc.savedOnly || proc.status === 'saved'
                const isErrored = proc.status === 'errored'
                const targetId = proc.savedOnly ? proc.name : String(proc.id)

                return (
                  <div
                    key={proc.uidKey}
                    className={cn(
                      'flex flex-col justify-between rounded-xl border p-3.5 transition-colors',
                      isOnline
                        ? 'border-border bg-card/70 hover:border-cyan-500/35'
                        : isErrored
                          ? 'border-rose-500/35 bg-rose-500/5'
                          : 'border-border/60 bg-background/40',
                    )}
                  >
                    <div>
                      {/* Cabeçalho do Card */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={cn(
                                'font-mono text-[10px] uppercase',
                                proc.engine === 'procman'
                                  ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300'
                                  : 'border-violet-400/40 bg-violet-500/10 text-violet-300',
                              )}
                            >
                              {proc.engine}
                            </Badge>
                            <Badge variant="secondary" className="font-mono text-[10px]">
                              @{proc.owner}
                            </Badge>
                            <span className="font-mono text-xs text-muted-foreground">
                              #{proc.id}
                            </span>
                            <h3 className="truncate font-mono text-sm font-semibold text-foreground">
                              {proc.name}
                            </h3>
                            {proc.namespace && proc.namespace !== 'default' && (
                              <Badge variant="outline" className="font-mono text-[10px]">
                                ns:{proc.namespace}
                              </Badge>
                            )}
                          </div>

                          <div
                            className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                            title={proc.script}
                          >
                            {proc.script || proc.cwd || '—'}
                          </div>
                          {proc.cwd && proc.cwd !== proc.script && (
                            <div
                              className="flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground/80"
                              title={proc.cwd}
                            >
                              <File className="size-3 shrink-0" />
                              <span className="truncate">{proc.cwd}</span>
                            </div>
                          )}
                        </div>

                        <Badge
                          variant="outline"
                          className={cn(
                            'shrink-0 font-mono text-[10px] uppercase',
                            isOnline
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                              : isErrored
                                ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                                : isSaved
                                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                                  : 'border-border text-muted-foreground',
                          )}
                        >
                          {isSaved ? 'DUMP SALVO' : proc.status}
                        </Badge>
                      </div>

                      {/* Métricas e Chips */}
                      <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg border border-border/60 bg-background/50 p-2 font-mono text-xs">
                        <div>
                          <div className="text-[10px] text-muted-foreground">CPU</div>
                          <div className="font-semibold text-cyan-300">
                            {isOnline ? `${proc.cpu.toFixed(1)}%` : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">MEMÓRIA</div>
                          <div className="font-semibold text-violet-300">
                            {isOnline ? formatBytes(proc.memory, 1) : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">UPTIME</div>
                          <div className="font-semibold">
                            {isOnline && proc.uptimeMs > 0
                              ? formatDuration(Math.floor(proc.uptimeMs / 1000))
                              : '—'}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-muted-foreground">RESTARTS</div>
                          <div className="font-semibold">
                            {proc.restarts}
                            {proc.unstableRestarts > 0 && (
                              <span className="ml-1 text-[10px] text-amber-400">
                                ({proc.unstableRestarts}!)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Badges de Modo, PID, Portas, Watch, Cron */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {proc.mode === 'cluster'
                            ? `cluster (${proc.instances}x)`
                            : 'fork'}
                        </Badge>
                        {proc.pid ? (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            PID: {proc.pid}
                          </Badge>
                        ) : null}
                        {proc.ports.map((port) => (
                          <a
                            key={String(port)}
                            href={`http://${hostIp}:${port}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-cyan-400/35 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-cyan-300 hover:bg-cyan-500/20"
                          >
                            :{port}
                            <Link2 className="size-2.5" />
                          </a>
                        ))}
                        {proc.watch && (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            watch
                          </Badge>
                        )}
                        {proc.cron && (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            cron: {proc.cron}
                          </Badge>
                        )}
                        {proc.maxMemoryRestart && (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            max-mem: {proc.maxMemoryRestart}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Botões de Ação */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-1.5 border-t border-border/60 pt-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {isSaved ? (
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => handleAction(proc.engine, proc.owner, 'resurrect')}
                            className="border-emerald-500/40 text-emerald-300"
                          >
                            <Play className="size-3" />
                            Resurrect ({proc.owner})
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() =>
                                handleAction(proc.engine, proc.owner, 'restart', targetId)
                              }
                              title="Reiniciar processo (restart)"
                            >
                              <RotateCw className="size-3 text-cyan-400" />
                              Restart
                            </Button>

                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() =>
                                handleAction(proc.engine, proc.owner, 'reload', targetId)
                              }
                              title="Reload sem downtime"
                            >
                              <RefreshCw className="size-3 text-emerald-400" />
                              Reload
                            </Button>

                            {isOnline && (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() =>
                                  handleAction(proc.engine, proc.owner, 'stop', targetId)
                                }
                                title="Parar processo (stop)"
                              >
                                <Square className="size-3 text-amber-400" />
                                Stop
                              </Button>
                            )}

                            {proc.mode === 'cluster' && (
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => {
                                  setScaleTarget(proc)
                                  setScaleInstances(String(proc.instances || 2))
                                }}
                                title="Escalar número de instâncias em cluster"
                              >
                                <Layers className="size-3 text-violet-400" />
                                Scale
                              </Button>
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            setLogTarget(proc)
                            setLogTab('out')
                            setLogFilter('')
                          }}
                          title="Visualizar logs stdout e stderr"
                        >
                          <ScrollText className="size-3.5 text-cyan-400" />
                          Logs
                        </Button>

                        {!isSaved && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() =>
                              handleAction(proc.engine, proc.owner, 'delete', targetId)
                            }
                            className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                            title="Parar e remover da lista (delete)"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal: Visualizador de Logs */}
      <AlertDialog open={!!logTarget} onOpenChange={(v) => !v && setLogTarget(null)}>
        <AlertDialogContent className="max-w-4xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex flex-wrap items-center gap-2 font-mono text-sm">
              <Terminal className="size-4 text-cyan-400" />
              Logs · {logTarget?.name}{' '}
              <Badge variant="outline" className="font-mono text-[10px]">
                {logTarget?.engine} @{logTarget?.owner}
              </Badge>
            </AlertDialogTitle>
            <AlertDialogDescription className="font-mono text-xs break-all">
              {logTab === 'out' ? logData?.outLog || logTarget?.outLog : logData?.errLog || logTarget?.errLog}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-wrap items-center justify-between gap-2 py-1">
            <div className="flex items-center gap-1.5">
              <Button
                size="xs"
                variant={logTab === 'out' ? 'default' : 'outline'}
                onClick={() => setLogTab('out')}
              >
                STDOUT ({logData?.outLines.length ?? 0})
              </Button>
              <Button
                size="xs"
                variant={logTab === 'err' ? 'default' : 'outline'}
                onClick={() => setLogTab('err')}
              >
                STDERR ({logData?.errLines.length ?? 0})
              </Button>
              <select
                value={logLines}
                onChange={(e) => setLogLines(Number(e.target.value))}
                className="h-7 rounded-md border border-border bg-background px-2 font-mono text-xs"
              >
                <option value={80}>80 linhas</option>
                <option value={150}>150 linhas</option>
                <option value={300}>300 linhas</option>
                <option value={500}>500 linhas</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                placeholder="Filtrar linhas…"
                className="h-7 w-48 text-xs"
              />
              {logTarget && (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={loadingLogs}
                  onClick={() => loadProcessLogs(logTarget, logLines)}
                >
                  {loadingLogs ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  Recarregar
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto rounded-lg border border-border bg-black/80 p-3 font-mono text-xs leading-relaxed text-zinc-200">
            {loadingLogs ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Carregando linhas de log…
              </div>
            ) : visibleLogLines.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                Nenhuma linha encontrada neste arquivo de log.
              </div>
            ) : (
              visibleLogLines.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'whitespace-pre-wrap break-all py-0.5',
                    logTab === 'err' && 'text-rose-300',
                  )}
                >
                  {line}
                </div>
              ))
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Fechar</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: Escalar Instâncias */}
      <AlertDialog open={!!scaleTarget} onOpenChange={(v) => !v && setScaleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Layers className="size-4 text-violet-400" /> Escalar Cluster · {scaleTarget?.name}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Defina a quantidade de workers para <span className="font-mono">{scaleTarget?.name}</span> ({scaleTarget?.engine} @{scaleTarget?.owner}). Use <span className="font-mono">0</span> no procman para 1 worker por núcleo de CPU.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              type="number"
              min={0}
              max={64}
              value={scaleInstances}
              onChange={(e) => setScaleInstances(e.target.value)}
              placeholder="Número de instâncias (ex: 4)"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!scaleTarget) return
                handleAction(
                  scaleTarget.engine,
                  scaleTarget.owner,
                  'scale',
                  String(scaleTarget.id),
                  Number(scaleInstances) || 1,
                )
                setScaleTarget(null)
              }}
            >
              Aplicar Scale
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: Iniciar Novo App / Ecosystem */}
      <AlertDialog open={startOpen} onOpenChange={setStartOpen}>
        <AlertDialogContent className="max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Play className="size-4 text-emerald-400" /> Iniciar Processo ou Ecosystem File
            </AlertDialogTitle>
            <AlertDialogDescription>
              Inicie um script Node.js ou arquivo <span className="font-mono">ecosystem.config.js</span> no daemon do usuário escolhido.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-3 py-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Gerenciador (Engine)</label>
              <select
                value={startEngine}
                onChange={(e) => setStartEngine(e.target.value as ProcManagerEngine)}
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs"
              >
                <option value="procman">procman (procmand)</option>
                <option value="pm2">PM2</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Usuário do SO (Dono)</label>
              <select
                value={startOwner}
                onChange={(e) => setStartOwner(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs"
              >
                {(overview?.runtimes.users ?? []).map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.username} (UID {u.uid})
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">
                Caminho do Script ou Ecosystem File *
              </label>
              <Input
                value={startScript}
                onChange={(e) => setStartScript(e.target.value)}
                placeholder="/home/usuario/app/src/server.js ou ecosystem.config.js"
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Nome do App (--name)</label>
              <Input
                value={startName}
                onChange={(e) => setStartName(e.target.value)}
                placeholder="api-backend"
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Namespace (--namespace)</label>
              <Input
                value={startNamespace}
                onChange={(e) => setStartNamespace(e.target.value)}
                placeholder="default"
                className="font-mono text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">
                Diretório de Trabalho (--cwd, opcional)
              </label>
              <Input
                value={startCwd}
                onChange={(e) => setStartCwd(e.target.value)}
                placeholder="/home/usuario/app"
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Modo de Execução</label>
              <select
                value={startMode}
                onChange={(e) => setStartMode(e.target.value as 'fork' | 'cluster')}
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs"
              >
                <option value="fork">fork (1 processo)</option>
                <option value="cluster">cluster (balanceado)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Instâncias (-i, ex: 2, 4 ou max)
              </label>
              <Input
                value={startInstances}
                onChange={(e) => setStartInstances(e.target.value)}
                placeholder={startMode === 'cluster' ? 'max' : '1'}
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Limite de RAM (--max-memory-restart)
              </label>
              <Input
                value={startMaxMem}
                onChange={(e) => setStartMaxMem(e.target.value)}
                placeholder="ex: 300M ou 1G"
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Cron Restart (--cron, opcional)
              </label>
              <Input
                value={startCron}
                onChange={(e) => setStartCron(e.target.value)}
                placeholder="ex: 0 4 * * *"
                className="font-mono text-xs"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs text-muted-foreground">
                Argumentos Extras após `--` (opcional)
              </label>
              <Input
                value={startArgs}
                onChange={(e) => setStartArgs(e.target.value)}
                placeholder="ex: --port 3000"
                className="font-mono text-xs"
              />
            </div>

            <div className="sm:col-span-2 flex items-center gap-2 pt-1">
              <input
                id="procman-watch"
                type="checkbox"
                checked={startWatch}
                onChange={(e) => setStartWatch(e.target.checked)}
                className="size-4 rounded border-border"
              />
              <label htmlFor="procman-watch" className="text-xs text-foreground">
                Ativar <span className="font-mono">--watch</span> (reiniciar automaticamente ao editar arquivos)
              </label>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={startingApp}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={startingApp}
              onClick={(e) => {
                e.preventDefault()
                handleStartApp()
              }}
            >
              {startingApp ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              Iniciar Processo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: Cofre Sudo */}
      <AlertDialog open={sudoOpen} onOpenChange={setSudoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-cyan-400" /> Cofre de Elevação Sudo (Multi-Usuário)
            </AlertDialogTitle>
            <AlertDialogDescription>
              Para inspecionar diretórios restritos (<span className="font-mono">/root/.procman</span>, <span className="font-mono">/root/.pm2</span>) e controlar processos de qualquer usuário do Linux, informe a credencial sudo.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Usuário com permissão sudo
              </label>
              <select
                value={sudoUser}
                onChange={(e) => setSudoUser(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2.5 font-mono text-xs"
              >
                {(overview?.sudo.humanUsers ?? []).map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.username} (UID {u.uid}){u.isSudoer ? ' · sudo' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Senha do usuário no Linux (sudo)
              </label>
              <Input
                type="password"
                value={sudoPass}
                onChange={(e) => setSudoPass(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingSudo}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingSudo}
              onClick={(e) => {
                e.preventDefault()
                handleSaveSudo()
              }}
            >
              {savingSudo ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 size-3.5" />
              )}
              Validar e Salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
