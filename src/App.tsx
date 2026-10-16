import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Boxes,
  Cpu,
  Eraser,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogOut,
  MemoryStick,
  Network,
  Server,
  ShieldCheck,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
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
import { Dashboard } from '@/components/Dashboard'
import { DiskExplorer } from '@/components/DiskExplorer'
import { ProcessManager } from '@/components/ProcessManager'
import { MemoryPanel } from '@/components/MemoryPanel'
import { RedePanel } from '@/components/RedePanel'
import { DockerPanel } from '@/components/DockerPanel'
import { SshPanel } from '@/components/SshPanel'
import { CleanupPanel } from '@/components/CleanupPanel'
import { LoginScreen } from '@/components/LoginScreen'
import { api, UNAUTHORIZED_EVENT } from '@/lib/api'
import type { AuthUser } from '@/lib/api'
import { usePoll } from '@/lib/usePoll'
import { formatBytes, formatDuration } from '@/lib/format'

function HeaderStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card/60 px-3 py-1.5">
      {icon}
      <div className="leading-tight">
        <div className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</div>
        <div className="font-mono text-xs font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  )
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <img
          src="/logo-mark.png"
          alt="Linux Resource"
          width={72}
          height={72}
          className="size-18"
        />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> carregando…
        </div>
      </div>
    </div>
  )
}

function UserMenu({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <div className="flex items-center gap-1 rounded-lg border bg-card/60 py-1 pr-1 pl-2">
        <Badge variant="secondary" className="h-auto gap-1 border-transparent bg-transparent px-1 font-mono text-xs">
          <User className="size-3.5 text-emerald-400" />
          {user.username}
        </Badge>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setOpen(true)}>
          <KeyRound className="size-3.5" /> Senha
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
          onClick={onLogout}
        >
          <LogOut className="size-3.5" /> Sair
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-400" /> Alterar senha
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

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <img
              src="/logo-mark.png"
              alt="Linux Resource"
              width={44}
              height={44}
              className="size-11 shrink-0 object-cover"
            />
            <div>
              <h1 className="text-base leading-tight font-semibold">
                Linux Resource <span className="font-normal text-muted-foreground">· System Console</span>
              </h1>
              <p className="text-xs text-muted-foreground">
                {sys ? (
                  <>
                    {sys.hostname} · {sys.platform} · {sys.arch}
                  </>
                ) : (
                  'conectando ao host…'
                )}
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <HeaderStat icon={<Cpu className="size-4 text-violet-400" />} label="CPU" value={`${cpu.toFixed(0)}%`} />
            <HeaderStat
              icon={<MemoryStick className="size-4 text-emerald-400" />}
              label="RAM"
              value={mem ? `${formatBytes(mem.used, 1)} · ${memPct.toFixed(0)}%` : '—'}
            />
            <HeaderStat
              icon={<Activity className="size-4 text-amber-400" />}
              label="Load"
              value={(sys?.loadavg ?? [0, 0, 0]).map((l) => l.toFixed(2)).join(' · ')}
            />
            <HeaderStat
              icon={<Activity className="size-4 text-sky-400" />}
              label="Uptime"
              value={sys ? formatDuration(sys.uptime) : '—'}
            />
            <Badge variant="outline" className="h-auto gap-1 py-1.5">
              <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
              {sys ? `${sys.ncpu} vCPU` : 'offline'}
            </Badge>
            <UserMenu user={user} onLogout={onLogout} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6">
        <Tabs defaultValue="dashboard">
          <TabsList className="mb-4 flex-wrap">
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
            <TabsTrigger value="limpeza">
              <Eraser className="size-4" /> Limpeza
            </TabsTrigger>
          </TabsList>

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
          <TabsContent value="limpeza">
            <CleanupPanel />
          </TabsContent>
        </Tabs>
      </main>

      <footer className="mt-8 border-t">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-center gap-x-2 px-4 py-5 text-center text-xs text-muted-foreground sm:px-6">
          <img src="/logo-mark.png" alt="" width={20} height={20} className="size-5 object-cover" />
          <span className="font-medium text-foreground">Linux Resource</span>
          <span>· gerenciar, monitorar e otimizar</span>
          <span className="hidden sm:inline">· dados lidos de /proc, /sys e Docker</span>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  const [loading, setLoading] = useState(true)
  const [setup, setSetup] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let alive = true
    api
      .authStatus()
      .then((s) => {
        if (!alive) return
        setSetup(s.setup)
        setUser(s.authenticated ? s.user : null)
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
