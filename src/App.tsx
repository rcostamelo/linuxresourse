import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Boxes,
  Check,
  ChevronDown,
  Cpu,
  Eraser,
  Globe,
  Gpu,
  HardDrive,
  KeyRound,
  Layers,
  LayoutDashboard,
  Loader2,
  LogOut,
  MemoryStick,
  Network,
  Radio,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Timer,
  User,
  Zap,
} from '@/components/ui/lucide-animated'
import { toast } from 'sonner'
import { Tabs, TabsContent } from '@/components/ui/tabs'
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
import { NginxPanel } from '@/components/NginxPanel'
import { SshPanel } from '@/components/SshPanel'
import { ProcManagersPanel } from '@/components/ProcManagersPanel'
import { CleanupPanel } from '@/components/CleanupPanel'
import { OsUsersPanel } from '@/components/OsUsersPanel'
import { SystemUpdatePanel } from '@/components/SystemUpdatePanel'
import { LoginScreen } from '@/components/LoginScreen'
import { PanelUsersModal } from '@/components/PanelUsersModal'
import { SessionHoldModal, KEEP_ALIVE_STORAGE_KEY } from '@/components/SessionHoldModal'
import { api, UNAUTHORIZED_EVENT } from '@/lib/api'
import type { AuthHostSummary, AuthUser } from '@/lib/api'
import { ThemeProvider, ThemeSwitcher, useTheme } from '@/lib/theme'
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
        'relative flex min-w-[88px] shrink-0 flex-col justify-between gap-1 overflow-hidden rounded-lg border bg-card/75 px-2.5 py-1 backdrop-blur-md transition-colors',
        isCritical ? 'border-rose-500/40 bg-rose-950/20' : 'border-cyan-500/15 hover:border-cyan-400/30',
      )}
    >
      <div className="flex items-center gap-1.5">
        <div className="grid size-5 shrink-0 place-items-center rounded-md bg-cyan-500/10 ring-1 ring-cyan-400/20">
          {icon}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center justify-between gap-1">
            <span className="font-mono text-[9px] font-medium tracking-wider text-muted-foreground uppercase">
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
          <div className="truncate font-mono text-[11px] font-semibold tracking-tight text-foreground tabular-nums">
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

function formatRemaining(expiresAt: number | null): string {
  if (!expiresAt) return 'temporária'
  const diff = expiresAt - Date.now()
  if (diff <= 0) return 'expirada'
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))
  if (days >= 300) return 'permanente'
  if (days > 0) return `${days}d`
  const hours = Math.floor(diff / (60 * 60 * 1000))
  return `${hours}h`
}

function UserMenu({
  user,
  sessionExpiresAt,
  onSessionUpdated,
  onLogout,
}: {
  user: AuthUser
  sessionExpiresAt: number | null
  onSessionUpdated: (expiresAt: number) => void
  onLogout: () => void
}) {
  const [sessionHoldOpen, setSessionHoldOpen] = useState(false)
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
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border bg-card/75 px-2.5 py-1.5 font-mono text-xs backdrop-blur-md transition-colors',
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
          <div className="absolute right-0 top-full z-50 mt-1.5 w-48 overflow-hidden rounded-xl border border-cyan-500/30 bg-popover p-1 shadow-[0_18px_50px_rgba(0,0,0,0.8)]">
            <div className="border-b border-border px-2.5 py-2">
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-xs font-semibold text-foreground">@{user.username}</span>
                <span className="rounded bg-cyan-500/15 px-1 py-0.2 font-mono text-[9px] font-semibold text-cyan-300 uppercase">
                  {user.role || 'admin'}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                <span>Sessão: {formatRemaining(sessionExpiresAt)}</span>
              </div>
            </div>
            <div className="pt-1">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  setSessionHoldOpen(true)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-cyan-500/15 hover:text-cyan-200"
              >
                <Timer className="size-3.5 text-cyan-400" />
                <span>Segurar sessão / Duração</span>
              </button>
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
      <SessionHoldModal
        open={sessionHoldOpen}
        onOpenChange={setSessionHoldOpen}
        currentUser={user}
        sessionExpiresAt={sessionExpiresAt}
        onSessionUpdated={onSessionUpdated}
      />

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

interface NavItem {
  value: string
  label: string
  desc: string
  icon: React.ReactNode
}

interface NavGroup {
  id: string
  label: string
  icon: React.ReactNode
  items: NavItem[]
}

function CategorizedNavBar({
  activeTab,
  onSelectTab,
  hasGpu,
  updateAvailable,
  latestVersion,
}: {
  activeTab: string
  onSelectTab: (v: string) => void
  hasGpu: boolean
  updateAvailable?: boolean
  latestVersion?: string
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const navRef = useRef<HTMLDivElement | null>(null)

  const groups: NavGroup[] = useMemo(() => {
    const hardwareItems: NavItem[] = [
      {
        value: 'processos',
        label: 'Processos',
        desc: 'CPU, threads e árvore de execução',
        icon: <Cpu className="size-3.5 text-violet-400" />,
      },
      {
        value: 'memoria',
        label: 'Memória',
        desc: 'RAM, buffers, cache e swap',
        icon: <MemoryStick className="size-3.5 text-emerald-400" />,
      },
      {
        value: 'disco',
        label: 'Disco',
        desc: 'Partições, NVMe/SSD e uso por pasta',
        icon: <HardDrive className="size-3.5 text-amber-400" />,
      },
    ]
    if (hasGpu) {
      hardwareItems.push({
        value: 'gpu',
        label: 'GPU',
        desc: 'VRAM, clocks, sensores e processos',
        icon: <Gpu className="size-3.5 text-cyan-400" />,
      })
    }

    return [
      {
        id: 'hardware',
        label: 'Hardware & Recursos',
        icon: <Cpu className="size-3.5" />,
        items: hardwareItems,
      },
      {
        id: 'servicos',
        label: 'Serviços & Rede',
        icon: <Layers className="size-3.5" />,
        items: [
          {
            value: 'procman',
            label: 'Procman & PM2',
            desc: 'Supervisores multi-usuário (root e /home/*)',
            icon: <Zap className="size-3.5 text-cyan-400" />,
          },
          {
            value: 'nginx',
            label: 'Nginx',
            desc: 'Virtual hosts, proxy reverso e logs',
            icon: <Globe className="size-3.5 text-emerald-400" />,
          },
          {
            value: 'docker',
            label: 'Docker',
            desc: 'Containers, imagens, logs e volumes',
            icon: <Boxes className="size-3.5 text-sky-400" />,
          },
          {
            value: 'rede',
            label: 'Rede',
            desc: 'Interfaces, banda, latência e conexões TCP',
            icon: <Network className="size-3.5 text-cyan-400" />,
          },
          {
            value: 'ssh',
            label: 'SSH & Clusters',
            desc: 'Monitoramento remoto e runbooks SSH',
            icon: <Server className="size-3.5 text-violet-400" />,
          },
        ],
      },
      {
        id: 'sistema',
        label: 'Administração & Sistema',
        icon: <ShieldCheck className="size-3.5" />,
        items: [
          {
            value: 'usuarios',
            label: 'Usuários (SO)',
            desc: 'Contas Linux, grupos e cofre sudo',
            icon: <User className="size-3.5 text-cyan-400" />,
          },
          {
            value: 'limpeza',
            label: 'Limpeza',
            desc: 'Caches, logs systemd e pacotes órfãos',
            icon: <Eraser className="size-3.5 text-amber-400" />,
          },
          {
            value: 'sobre',
            label: 'Sobre & Atualizações',
            desc: 'Update 1-click, versão e releases do GitHub',
            icon: <Sparkles className="size-3.5 text-emerald-400" />,
          },
        ],
      },
    ]
  }, [hasGpu])

  useEffect(() => {
    if (!openGroup) return
    function onDocClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null)
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenGroup(null)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [openGroup])

  const activeDashboard = activeTab === 'dashboard'

  return (
    <div
      ref={navRef}
      data-slot="tabs-list"
      className="relative z-30 inline-flex flex-wrap items-center gap-1 rounded-xl bg-card/90 p-1 text-muted-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] ring-1 ring-cyan-500/15"
    >
      {/* Dashboard Fixo */}
      <button
        type="button"
        onClick={() => {
          setOpenGroup(null)
          onSelectTab('dashboard')
        }}
        className={cn(
          'relative inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium tracking-wide whitespace-nowrap transition-all',
          activeDashboard
            ? 'border-cyan-400/30 bg-gradient-to-b from-cyan-500/15 to-emerald-500/10 text-cyan-200 shadow-[0_0_16px_-4px_rgba(34,211,238,0.35)] after:pointer-events-none after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-full after:bg-gradient-to-r after:from-cyan-400 after:to-emerald-400'
            : 'border-transparent text-muted-foreground hover:bg-cyan-500/5 hover:text-foreground',
        )}
      >
        <LayoutDashboard className={cn('size-3.5', activeDashboard && 'text-cyan-400')} />
        <span>Dashboard</span>
      </button>

      {/* Dropdowns Categorizados */}
      {groups.map((group) => {
        const activeChild = group.items.find((i) => i.value === activeTab)
        const isOpen = openGroup === group.id

        return (
          <div key={group.id} className="relative">
            <button
              type="button"
              onClick={() => setOpenGroup((cur) => (cur === group.id ? null : group.id))}
              className={cn(
                'relative inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium tracking-wide whitespace-nowrap transition-all',
                activeChild
                  ? 'border-cyan-400/30 bg-gradient-to-b from-cyan-500/15 to-emerald-500/10 text-cyan-200 shadow-[0_0_16px_-4px_rgba(34,211,238,0.35)] after:pointer-events-none after:absolute after:inset-x-2.5 after:bottom-0 after:h-[2px] after:rounded-full after:bg-gradient-to-r after:from-cyan-400 after:to-emerald-400'
                  : isOpen
                    ? 'border-cyan-400/25 bg-cyan-500/10 text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-cyan-500/5 hover:text-foreground',
              )}
            >
              <span className={cn(activeChild && 'text-cyan-400')}>{group.icon}</span>
              <span>{group.label}</span>
              {group.id === 'sistema' && updateAvailable && (
                <span className="size-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" title={`Nova versão v${latestVersion} disponível`} />
              )}
              {activeChild && (
                <span className="rounded-md border border-cyan-400/30 bg-cyan-500/15 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-cyan-200">
                  {activeChild.label}
                </span>
              )}
              <ChevronDown
                className={cn(
                  'size-3.5 text-muted-foreground transition-transform duration-200',
                  isOpen && 'rotate-180 text-cyan-300',
                )}
              />
            </button>

            {isOpen && (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-cyan-500/30 bg-popover p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.8)]">
                <div className="border-b border-border px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {group.label}
                </div>
                <div className="mt-1 space-y-0.5">
                  {group.items.map((item) => {
                    const isItemActive = item.value === activeTab
                    return (
                      <button
                        key={item.value}
                        type="button"
                        onClick={() => {
                          onSelectTab(item.value)
                          setOpenGroup(null)
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                          isItemActive
                            ? 'bg-cyan-500/15 text-foreground ring-1 ring-cyan-400/30'
                            : 'text-foreground/90 hover:bg-muted/80',
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-background">
                            {item.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 truncate font-mono text-xs font-semibold leading-tight">
                              <span>{item.label}</span>
                              {item.value === 'sobre' && updateAvailable && (
                                <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-400/40">
                                  v{latestVersion}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[10px] text-muted-foreground">
                              {item.desc}
                            </div>
                          </div>
                        </div>
                        {isItemActive && <Check className="size-3.5 shrink-0 text-cyan-400" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const VALID_TABS = new Set([
  'dashboard', 'procman', 'rede', 'nginx', 'docker', 'ssh',
  'disco', 'processos', 'memoria', 'gpu', 'limpeza', 'usuarios', 'sobre',
])

function tabFromHash(): string {
  const h = window.location.hash.replace(/^#/, '').trim()
  return VALID_TABS.has(h) ? h : 'dashboard'
}

function Console({
  user,
  sessionExpiresAt,
  onSessionUpdated,
  onLogout,
}: {
  user: AuthUser
  sessionExpiresAt: number | null
  onSessionUpdated: (expiresAt: number) => void
  onLogout: () => void
}) {
  const { data: sys } = usePoll(api.system, 2000)
  const { data: mem } = usePoll(api.memory, 2000)

  useEffect(() => {
    // Keep-alive silencioso: renova o cookie no servidor a cada 5 minutos se ativado
    const id = setInterval(() => {
      try {
        if (localStorage.getItem(KEEP_ALIVE_STORAGE_KEY) !== 'false') {
          api.authKeepAlive().then((res) => {
            if (res?.sessionExpiresAt) onSessionUpdated(res.sessionExpiresAt)
          }).catch(() => {})
        }
      } catch {}
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [onSessionUpdated])
  const { data: about } = usePoll(api.systemUpdateOverview, 30 * 60 * 1000)
  const [activeTab, setActiveTabState] = useState(tabFromHash)
  const [dismissedUpdateVer, setDismissedUpdateVer] = useState<string | null>(() => {
    try { return sessionStorage.getItem('lr_dismissed_update') } catch { return null }
  })
  const toastedVerRef = useRef<string | null>(null)

  const setActiveTab = useCallback((v: string) => {
    setActiveTabState(v)
    const nextHash = v === 'dashboard' ? '' : `#${v}`
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash || window.location.pathname)
    }
  }, [])

  useEffect(() => {
    const onHash = () => setActiveTabState(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const updateAvailable = Boolean(about?.updateAvailable && about.latestVersion)
  const latestVersion = about?.latestVersion ?? ''

  useEffect(() => {
    if (!updateAvailable || !latestVersion || toastedVerRef.current === latestVersion) return
    toastedVerRef.current = latestVersion
    toast.info(`Nova versão v${latestVersion} disponível`, {
      description: `Você está na v${about?.currentVersion ?? APP_VERSION}. Clique para ver as novidades e atualizar.`,
      duration: 15000,
      action: { label: 'Atualizar agora', onClick: () => setActiveTab('sobre') },
    })
  }, [updateAvailable, latestVersion, about?.currentVersion, setActiveTab])

  const cpu = sys?.cpuUsage ?? 0
  const memPct = mem ? (mem.used / mem.total) * 100 : 0
  const loadPct = sys ? Math.min(100, ((sys.loadavg?.[0] ?? 0) / Math.max(1, sys.ncpu)) * 100) : 0
  const gpuInfo = sys?.gpu
  const primaryGpu = gpuInfo?.available ? gpuInfo.primary : null

  return (
    <div className="min-h-dvh bg-transparent">
      <header className="sticky top-0 z-40 border-b border-cyan-500/15 bg-background/85 shadow-[0_4px_30px_rgba(0,0,0,0.45)] backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-cyan-400/45 before:to-transparent">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-6 lg:flex-nowrap">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative shrink-0">
              <div className="absolute -inset-1 rounded-xl bg-cyan-500/15 blur-md" />
              <img
                src="/logo-mark.png"
                alt="Linux Resource"
                width={38}
                height={38}
                className="relative size-9.5 shrink-0 rounded-lg object-cover ring-1 ring-cyan-400/25"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="truncate text-sm leading-tight font-semibold tracking-tight sm:text-base">
                  Linux Resource
                </h1>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-cyan-300 uppercase">
                  <Terminal className="size-2.5" />
                  <span className="hidden 2xl:inline">Mission Control</span> v{APP_VERSION}
                </span>
                {updateAvailable && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('sobre')}
                    title={`Nova versão v${latestVersion} disponível — clique para atualizar`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-emerald-300 transition hover:bg-emerald-500/25"
                  >
                    <Sparkles className="size-2.5 text-emerald-300" />
                    <span>Atualizar → v{latestVersion}</span>
                  </button>
                )}
              </div>
              <p className="mt-0.5 flex items-center gap-1 font-mono text-[10px] truncate text-muted-foreground">
                {sys ? (
                  <>
                    <span className="text-cyan-300/90">{sys.hostname}</span>
                    <span className="text-cyan-500/40">//</span>
                    <span className="truncate">{sys.platform}</span>
                    <span className="text-cyan-500/40">//</span>
                    <span>{sys.arch}</span>
                  </>
                ) : (
                  'conectando à telemetria do host…'
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 lg:flex-nowrap">
            <HeaderStat
              icon={<Cpu className="size-3 text-violet-400" />}
              label="CPU"
              value={sys ? (sys.cpuTemp?.available && sys.cpuTemp.temperature != null ? `${sys.ncpu} vCPU · ${sys.cpuTemp.temperature.toFixed(0)}°C` : `${sys.ncpu} vCPU`) : '—'}
              title={sys?.cpuTemp?.available ? `${sys.cpuModel} · sensor ${sys.cpuTemp.label ?? sys.cpuTemp.sensor}` : sys?.cpuModel}
              progress={cpu}
              barColor="bg-gradient-to-r from-violet-500 to-cyan-400 shadow-[0_0_8px_rgba(139,92,246,0.5)]"
            />
            <HeaderStat
              icon={<MemoryStick className="size-3 text-emerald-400" />}
              label="RAM"
              value={mem ? formatBytes(mem.used, 1) : '—'}
              progress={memPct}
              barColor="bg-gradient-to-r from-emerald-500 to-cyan-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
            />
            {primaryGpu && (
              <HeaderStat
                icon={<Gpu className="size-3 text-cyan-400" />}
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
              icon={<Activity className="size-3 text-amber-400" />}
              label="Load"
              value={(sys?.loadavg ?? [0, 0, 0]).map((l) => l.toFixed(2)).join(' · ')}
              progress={loadPct}
              barColor="bg-gradient-to-r from-amber-500 to-orange-400"
            />
            <HeaderStat
              icon={<Radio className="size-3 text-sky-400" />}
              label="Uptime"
              value={sys ? formatDuration(sys.uptime) : '—'}
            />
            <Badge
              variant="outline"
              className="h-auto shrink-0 gap-1.5 border-emerald-500/25 bg-emerald-500/10 px-2 py-1.5 font-mono text-[10px] text-emerald-300"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              {sys ? 'ONLINE' : 'SYNC'}
            </Badge>
            <ThemeSwitcher />
            <UserMenu user={user} sessionExpiresAt={sessionExpiresAt} onSessionUpdated={onSessionUpdated} onLogout={onLogout} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="relative z-30 mb-4 flex flex-wrap items-center justify-between gap-3">
            <CategorizedNavBar
              activeTab={activeTab}
              onSelectTab={setActiveTab}
              hasGpu={Boolean(primaryGpu)}
              updateAvailable={updateAvailable}
              latestVersion={latestVersion}
            />

            <div className="hidden items-center gap-2 rounded-lg border border-cyan-500/15 bg-card/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground backdrop-blur-md xl:flex">
              <span className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
              <span>POLLING: 2000ms</span>
              <span className="text-cyan-500/40">|</span>
              <span className="text-cyan-300/90">
                /proc · /sys · procman · pm2 · nginx · docker.sock{primaryGpu ? ` · ${primaryGpu.vendor} GPU` : ''}
              </span>
            </div>
          </div>

          {updateAvailable && activeTab !== 'sobre' && dismissedUpdateVer !== latestVersion && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/35 bg-gradient-to-r from-emerald-500/15 via-cyan-500/10 to-transparent px-4 py-2.5 text-xs shadow-[0_0_25px_-8px_rgba(16,185,129,0.45)]">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-emerald-400/40 bg-emerald-500/20 text-emerald-300">
                  <Sparkles className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="font-mono font-semibold text-emerald-200">
                    Nova atualização disponível: Linux Resource v{latestVersion}{' '}
                    <span className="font-normal text-muted-foreground">(atual: v{about?.currentVersion ?? APP_VERSION})</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {about?.latestRelease?.name || 'Inclui melhorias, correções e novos recursos.'}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('sobre')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/50 bg-emerald-500/25 px-3 py-1.5 font-mono text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/35"
                >
                  <Zap className="size-3.5" />
                  Ver novidades e atualizar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDismissedUpdateVer(latestVersion)
                    try { sessionStorage.setItem('lr_dismissed_update', latestVersion) } catch {}
                  }}
                  className="rounded-lg px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  Depois
                </button>
              </div>
            </div>
          )}

          <div className="relative z-0">
            <TabsContent value="dashboard">
              <Dashboard />
            </TabsContent>
            <TabsContent value="procman">
              <ProcManagersPanel />
            </TabsContent>
            <TabsContent value="rede">
              <RedePanel />
            </TabsContent>
            <TabsContent value="nginx">
              <NginxPanel />
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
            <TabsContent value="sobre">
              <SystemUpdatePanel />
            </TabsContent>
          </div>
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
          <span className="hidden sm:inline">telemetria em tempo real via /proc, /sys, Procman, PM2, Nginx e Docker</span>
        </div>
      </footer>
    </div>
  )
}

function ThemedToaster() {
  const { themeMeta } = useTheme()
  return <Toaster theme={themeMeta.isDark ? 'dark' : 'light'} position="bottom-right" />
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [setup, setSetup] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null)
  const [hostInfo, setHostInfo] = useState<AuthHostSummary | null>(null)

  useEffect(() => {
    let alive = true
    api
      .authStatus()
      .then((s) => {
        if (!alive) return
        setSetup(s.setup)
        setUser(s.authenticated ? s.user : null)
        setSessionExpiresAt(s.sessionExpiresAt)
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
    <ThemeProvider>
      <TooltipProvider>
        {loading ? (
          <Splash />
        ) : user ? (
          <Console user={user} sessionExpiresAt={sessionExpiresAt} onSessionUpdated={setSessionExpiresAt} onLogout={logout} />
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
        <ThemedToaster />
      </TooltipProvider>
    </ThemeProvider>
  )
}
