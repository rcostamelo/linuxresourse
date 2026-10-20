import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  Boxes,
  ChevronDown,
  Cpu,
  Eraser,
  Gpu,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogOut,
  MemoryStick,
  Network,
  Radio,
  Server,
  ShieldCheck,
  Terminal,
  User,
} from '@/components/ui/lucide-animated'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { Badge } from '@/components/ui/badge'
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
import { Dashboard } from '@/components/Dashboard'
import { DiskExplorer } from '@/components/DiskExplorer'
import { ProcessManager } from '@/components/ProcessManager'
import { MemoryPanel } from '@/components/MemoryPanel'
import { GpuPanel } from '@/components/GpuPanel'
import { RedePanel } from '@/components/RedePanel'
import { DockerPanel } from '@/components/DockerPanel'
import { SshPanel } from '@/components/SshPanel'
import { CleanupPanel } from '@/components/CleanupPanel'
import { OsUsersPanel } from '@/components/OsUsersPanel'
import { LoginScreen } from '@/components/LoginScreen'
import { PanelUsersModal } from '@/components/PanelUsersModal'
import { api, UNAUTHORIZED_EVENT } from '@/lib/api'
import type { AuthHostSummary, AuthUser } from '@/lib/api'
import { usePoll } from '@/lib/usePoll'
import { formatBytes, formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { APP_VERSION } from '@/version'

function shortGpuName(name: string): string {
  return (
    name
      .replace(/\b(NVIDIA|AMD|Intel|Corporation|GeForce|Radeon|Graphics|Series|Laptop|Mobile)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || name
  )
}

function HeaderStat({
  icon,
  label,
  value,
  title,
  progress,
  barColor = 'bg-cyan-400',
}: {
  icon: React.ReactNode
  label: string
  value: string
  title?: string
  progress?: number
  barColor?: string
}) {
  const pct = progress !== undefined ? Math.max(0, Math.min(100, progress)) : undefined
  const isCritical = pct !== undefined && pct >= 85
  const isWarn = pct !== undefined && pct >= 65 && pct < 85

  const dynamicBarColor = isCritical
    ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]'
    : isWarn
      ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]'
      : barColor

  return (
    <div
      title={title}
      className={cn(
        'relative flex min-w-[116px] flex-col justify-between gap-1.5 overflow-hidden rounded-lg border bg-card/75 px-3 py-1.5 backdrop-blur-md transition-colors',
        isCritical ? 'border-rose-500/40 bg-rose-950/20' : 'border-cyan-500/15 hover:border-cyan-400/30',
      )}
    >
      <div className="flex items-center gap-2">
        <div className="grid size-6 shrink-0 place-items-center rounded-md bg-cyan-500/10 ring-1 ring-cyan-400/20">
          {icon}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center justify-between gap-1.5">
            <span className="font-mono text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
              {label}
            </span>
            {pct !== undefined && (
              <span
                className={cn(
                  'font-mono text-[9px] tabular-nums',
                  isCritical ? 'text-rose-400' : isWarn ? 'text-amber-300' : 'text-cyan-300/80',
                )}
              >
                {pct.toFixed(0)}%
              </span>
            )}
          </div>
          <div className="truncate font-mono text-xs font-semibold tracking-tight text-foreground tabular-nums">
            {value}
          </div>
        </div>
      </div>

      {pct !== undefined && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-900/90 ring-1 ring-white/5">
          <div
            className={cn('h-full rounded-full transition-all duration-500 ease-out', dynamicBarColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="absolute -inset-3 rounded-full bg-cyan-500/20 blur-xl" />
          <img
            src="/logo-mark.png"
            alt="Linux Resource"
            width={72}
            height={72}
            className="relative size-18"
          />
        </div>
        <div className="flex items-center gap-2 font-mono text-xs tracking-wider text-cyan-300/80 uppercase">
          <Loader2 className="size-4 animate-spin text-cyan-400" /> inicializando telemetria…
        </div>
      </div>
    </div>
  )
}

function UserMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [panelUsersOpen, setPanelUsersOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [menuOpen])

  async function changePassword() {
    setError(null)
    if (next !== confirm) return setError('as senhas não coincidem')
    if (next.length < 8) return setError('a nova senha precisa ter ao menos 8 caracteres')
    setBusy(true)
    try {
      await api.authChangePassword(current, next)
      toast.success('Senha alterada. As outras sessões foram encerradas.')
      setOpen(false)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            'flex items-center gap-2 rounded-lg border bg-card/75 px-3 py-1.5 font-mono text-xs backdrop-blur-md transition-colors',
            menuOpen
              ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200'
              : 'border-cyan-500/15 text-foreground hover:border-cyan-400/30 hover:bg-card',
          )}
        >
          <User className="size-3.5 text-cyan-400" />
          <span className="font-medium">{user.username}</span>
          <ChevronDown
            className={cn('size-3.5 text-muted-foreground transition-transform duration-200', menuOpen && 'rotate-180 text-cyan-300')}
          />
        </button>

        {menuOpen && (
          <div className="absolute right-0 z-50 mt-1.5 w-48 overflow-hidden rounded-xl border border-cyan-500/25 bg-popover/95 p-1 shadow-[0_12px_40px_rgba(0,0,0,0.65)] backdrop-blur-xl">
            <div className="border-b border-white/10 px-2.5 py-2">
              <div className="font-mono text-xs font-semibold text-foreground">{user.username}</div>
              <div className="font-mono text-[10px] tracking-wider text-cyan-400/80 uppercase">{user.role || 'admin'}</div>
            </div>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setPanelUsersOpen(true)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-cyan-500/15 hover:text-cyan-200"
              >
                <ShieldCheck className="size-3.5 text-emerald-400" />
                <span>Usuários do gerenciador</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setOpen(true)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-cyan-500/15 hover:text-cyan-200"
              >
                <KeyRound className="size-3.5 text-cyan-400" />
                <span>Alterar senha</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  onLogout()
                }}
                className="mt-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-rose-400 transition-colors hover:bg-destructive/15 hover:text-rose-300"
              >
                <LogOut className="size-3.5" />
                <span>Sair</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <PanelUsersModal open={panelUsersOpen} onOpenChange={setPanelUsersOpen} currentUser={user} />

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-cyan-400" /> Alterar senha
            </AlertDialogTitle>
            <AlertDialogDescription>
              As demais sessões de <span className="font-mono">{user.username}</span> serão encerradas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <Input
              type="password"
              placeholder="senha atual"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <Input
              type="password"
              placeholder="nova senha (mín. 8, letras e números)"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <Input
              type="password"
              placeholder="confirmar nova senha"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !current || !next}
              onClick={(e) => {
                e.preventDefault()
                changePassword()
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Salvar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Console({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const { data: sys } = usePoll(api.system, 2000)
  const { data: mem } = usePoll(api.memory, 2000)

  const cpu = sys?.cpuUsage ?? 0
  const memPct = mem ? (mem.used / mem.total) * 100 : 0
  const loadPct = sys ? Math.min(100, ((sys.loadavg?.[0] ?? 0) / Math.max(1, sys.ncpu)) * 100) : 0
  const gpuInfo = sys?.gpu
  const primaryGpu = gpuInfo?.available ? gpuInfo.primary : null

  return (
    <div className="min-h-dvh bg-transparent">
      <header className="sticky top-0 z-30 border-b border-cyan-500/15 bg-background/80 shadow-[0_4px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-cyan-400/45 before:to-transparent">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute -inset-1 rounded-xl bg-cyan-500/15 blur-md" />
              <img
                src="/logo-mark.png"
                alt="Linux Resource"
                width={44}
                height={44}
                className="relative size-11 shrink-0 rounded-lg object-cover ring-1 ring-cyan-400/25"
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base leading-tight font-semibold tracking-tight">
                  Linux Resource
                </h1>
                <span className="inline-flex items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-cyan-300 uppercase">
                  <Terminal className="size-2.5" /> Mission Control v{APP_VERSION}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                {sys ? (
                  <>
                    <span className="text-cyan-300/90">{sys.hostname}</span>
                    <span className="text-cyan-500/40">//</span>
                    <span>{sys.platform}</span>
                    <span className="text-cyan-500/40">//</span>
                    <span>{sys.arch}</span>
                  </>
                ) : (
                  'conectando à telemetria do host…'
                )}
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <HeaderStat
              icon={<Cpu className="size-3.5 text-violet-400" />}
              label="CPU"
              value={sys ? (sys.cpuTemp?.available && sys.cpuTemp.temperature != null ? `${sys.ncpu} vCPU · ${sys.cpuTemp.temperature.toFixed(0)}°C` : `${sys.ncpu} vCPU`) : '—'}
              title={sys?.cpuTemp?.available ? `${sys.cpuModel} · sensor ${sys.cpuTemp.label ?? sys.cpuTemp.sensor}` : sys?.cpuModel}
              progress={cpu}
              barColor="bg-gradient-to-r from-violet-500 to-cyan-400 shadow-[0_0_8px_rgba(139,92,246,0.5)]"
            />
            <HeaderStat
              icon={<MemoryStick className="size-3.5 text-emerald-400" />}
              label="RAM"
              value={mem ? formatBytes(mem.used, 1) : '—'}
              progress={memPct}
              barColor="bg-gradient-to-r from-emerald-500 to-cyan-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
            />
            {primaryGpu && (
              <HeaderStat
                icon={<Gpu className="size-3.5 text-cyan-400" />}
                label={gpuInfo && gpuInfo.count > 1 ? `GPU (${gpuInfo.count})` : 'GPU'}
                title={`${primaryGpu.name}${primaryGpu.driver ? ` · Driver ${primaryGpu.driver}` : ''}`}
                value={
                  primaryGpu.temperature != null
                    ? `${shortGpuName(primaryGpu.name)} · ${primaryGpu.temperature}°C`
                    : primaryGpu.memUsed != null
                      ? `${shortGpuName(primaryGpu.name)} · ${formatBytes(primaryGpu.memUsed, 1)}`
                      : shortGpuName(primaryGpu.name)
                }
                progress={primaryGpu.utilization ?? primaryGpu.memPct ?? undefined}
                barColor="bg-gradient-to-r from-cyan-400 to-emerald-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
              />
            )}
            <HeaderStat
              icon={<Activity className="size-3.5 text-amber-400" />}
              label="Load"
              value={(sys?.loadavg ?? [0, 0, 0]).map((l) => l.toFixed(2)).join(' · ')}
              progress={loadPct}
              barColor="bg-gradient-to-r from-amber-500 to-orange-400"
            />
            <HeaderStat
              icon={<Radio className="size-3.5 text-sky-400" />}
              label="Uptime"
              value={sys ? formatDuration(sys.uptime) : '—'}
            />
            <Badge
              variant="outline"
              className="h-auto gap-1.5 border-emerald-500/25 bg-emerald-500/10 px-2.5 py-2 font-mono text-[11px] text-emerald-300"
            >
              <span className="size-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              {sys ? 'ONLINE' : 'SYNC'}
            </Badge>
            <UserMenu user={user} onLogout={onLogout} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        <Tabs defaultValue="dashboard">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <TabsList className="flex-wrap">
              <TabsTrigger value="dashboard">
                <LayoutDashboard className="size-4" /> Dashboard
              </TabsTrigger>
              <TabsTrigger value="rede">
                <Network className="size-4" /> Rede
              </TabsTrigger>
              <TabsTrigger value="docker">
                <Boxes className="size-4" /> Docker
              </TabsTrigger>
              <TabsTrigger value="ssh">
                <Server className="size-4" /> SSH
              </TabsTrigger>
              <TabsTrigger value="disco">
                <HardDrive className="size-4" /> Disco
              </TabsTrigger>
              <TabsTrigger value="processos">
                <Cpu className="size-4" /> Processos
              </TabsTrigger>
              <TabsTrigger value="memoria">
                <MemoryStick className="size-4" /> Memória
              </TabsTrigger>
              {primaryGpu && (
                <TabsTrigger value="gpu">
                  <Gpu className="size-4" /> GPU
                </TabsTrigger>
              )}
              <TabsTrigger value="usuarios">
                <User className="size-4" /> Usuários
              </TabsTrigger>
              <TabsTrigger value="limpeza">
                <Eraser className="size-4" /> Limpeza
              </TabsTrigger>
            </TabsList>

            <div className="hidden items-center gap-2 rounded-lg border border-cyan-500/15 bg-card/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground backdrop-blur-md xl:flex">
              <span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
              <span>POLLING: 2000ms</span>
              <span className="text-cyan-500/40">|</span>
              <span className="text-cyan-300/90">
                /proc · /sys · docker.sock{primaryGpu ? ` · ${primaryGpu.vendor} GPU` : ''}
              </span>
            </div>
          </div>

          <TabsContent value="dashboard">
            <Dashboard />
          </TabsContent>
          <TabsContent value="rede">
            <RedePanel />
          </TabsContent>
          <TabsContent value="docker">
            <DockerPanel />
          </TabsContent>
          <TabsContent value="ssh">
            <SshPanel />
          </TabsContent>
          <TabsContent value="disco">
            <DiskExplorer />
          </TabsContent>
          <TabsContent value="processos">
            <ProcessManager />
          </TabsContent>
          <TabsContent value="memoria">
            <MemoryPanel />
          </TabsContent>
          {primaryGpu && (
            <TabsContent value="gpu">
              <GpuPanel />
            </TabsContent>
          )}
          <TabsContent value="limpeza">
            <CleanupPanel />
          </TabsContent>
          <TabsContent value="usuarios">
            <OsUsersPanel />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-8 border-t border-cyan-500/15 bg-background/40 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-center gap-x-2 px-4 py-5 text-center font-mono text-xs text-muted-foreground sm:px-6">
          <img src="/logo-mark.png" alt="" width={20} height={20} className="size-5 object-cover" />
          <span className="font-semibold text-foreground">Linux Resource</span>
          <span className="text-cyan-300">v{APP_VERSION}</span>
          <span className="text-cyan-500/50">//</span>
          <span>gerenciar, monitorar e otimizar</span>
          <span className="hidden text-cyan-500/50 sm:inline">//</span>
          <span className="hidden sm:inline">telemetria em tempo real via /proc, /sys e Docker</span>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [setup, setSetup] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [hostInfo, setHostInfo] = useState<AuthHostSummary | null>(null)

  useEffect(() => {
    let alive = true
    api
      .authStatus()
      .then((s) => {
        if (!alive) return
        setSetup(s.setup)
        setUser(s.authenticated ? s.user : null)
        if (s.host) setHostInfo(s.host)
      })
      .catch(() => {
        if (alive) setUser(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.authLogout()
    } catch {
      /* sessão já inválida */
    }
    setUser(null)
    setSetup(false)
  }, [])

  return (
    <TooltipProvider>
      {loading ? (
        <Splash />
      ) : user ? (
        <Console user={user} onLogout={logout} />
      ) : (
        <LoginScreen
          mode={setup ? 'setup' : 'login'}
          host={hostInfo}
          onSuccess={(u) => {
            setUser(u)
            setSetup(false)
          }}
        />
      )}
      <Toaster theme="dark" position="bottom-right" />
    </TooltipProvider>
  )
}
