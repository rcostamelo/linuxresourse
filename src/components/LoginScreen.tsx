import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Boxes,
  Check,
  Cpu,
  Eye,
  EyeOff,
  Gpu,
  HardDrive,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  Network,
  Radio,
  Server,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  User,
  UserPlus,
} from '@/components/ui/lucide-animated'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { AuthHostSummary, AuthUser } from '@/lib/api'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { APP_VERSION } from '@/version'

type Mode = 'login' | 'setup'

const REMEMBER_USER_KEY = 'lr:last_username'

const MODULES = [
  {
    icon: Cpu,
    title: 'Telemetria /proc & /sys',
    desc: 'CPU por núcleo, GPU, memória, swap, processos e load em tempo real (2s).',
    color: 'text-cyan-400 bg-cyan-500/10 ring-cyan-400/25',
  },
  {
    icon: HardDrive,
    title: 'Pool de Discos & Treemap',
    desc: 'Inspeção de todos os discos físicos, partições e mapa visual de diretórios.',
    color: 'text-emerald-400 bg-emerald-500/10 ring-emerald-400/25',
  },
  {
    icon: Boxes,
    title: 'Docker & Containers',
    desc: 'Controle de ciclo de vida, logs ao vivo, imagens, volumes e espaço recuperável.',
    color: 'text-sky-400 bg-sky-500/10 ring-sky-400/25',
  },
  {
    icon: Server,
    title: 'Frota SSH & Runbooks',
    desc: 'Clusters remotos, histórico SQLite, verificação SHA256 e comandos auditados.',
    color: 'text-violet-400 bg-violet-500/10 ring-violet-400/25',
  },
  {
    icon: Network,
    title: 'Rede & Conexões TCP',
    desc: 'Taxa RX/TX por placa, latência ICMP e mapeamento de sockets ativos.',
    color: 'text-amber-400 bg-amber-500/10 ring-amber-400/25',
  },
  {
    icon: Lock,
    title: 'Usuários do SO & Cofre Sudo',
    desc: 'CRUD de contas Linux, grupos (sudo/docker) e limpeza segura com AES-256-GCM.',
    color: 'text-rose-400 bg-rose-500/10 ring-rose-400/25',
  },
]

export function LoginScreen({
  mode,
  host: initialHost,
  onSuccess,
}: {
  mode: Mode
  host?: AuthHostSummary | null
  onSuccess: (user: AuthUser) => void
}) {
  const [username, setUsername] = useState(() => {
    try {
      return localStorage.getItem(REMEMBER_USER_KEY) || ''
    } catch {
      return ''
    }
  })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [host, setHost] = useState<AuthHostSummary | null>(initialHost ?? null)

  const isSetup = mode === 'setup'

  useEffect(() => {
    if (initialHost) setHost(initialHost)
  }, [initialHost])

  useEffect(() => {
    let alive = true
    const tick = () => {
      api
        .authStatus()
        .then((s) => {
          if (alive && s.host) setHost(s.host)
        })
        .catch(() => {})
    }
    if (!initialHost) tick()
    const id = window.setInterval(tick, 10000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [initialHost])

  const checks = useMemo(() => {
    const u = username.trim()
    return {
      userLen: u.length >= 3 && u.length <= 32 && /^[a-zA-Z0-9._-]+$/.test(u),
      passLen: password.length >= 8,
      passMix: /[a-zA-Z]/.test(password) && /\d/.test(password),
      passMatch: confirm.length > 0 && password === confirm,
    }
  }, [username, password, confirm])

  const strengthScore = useMemo(() => {
    if (!password) return 0
    let s = 0
    if (password.length >= 8) s += 1
    if (password.length >= 12) s += 1
    if (/[a-zA-Z]/.test(password) && /\d/.test(password)) s += 1
    if (/[^a-zA-Z0-9]/.test(password)) s += 1
    return s
  }, [password])

  function handleKeyEvent(e: React.KeyboardEvent<HTMLInputElement>) {
    if (typeof e.getModifierState === 'function') {
      setCapsLock(e.getModifierState('CapsLock'))
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const cleanUser = username.trim()

    if (isSetup) {
      if (!checks.userLen) return setError('o usuário precisa ter 3–32 caracteres (letras, números, ., - ou _)')
      if (!checks.passLen) return setError('a senha precisa ter ao menos 8 caracteres')
      if (!checks.passMix) return setError('inclua ao menos uma letra e um número na senha')
      if (password !== confirm) return setError('as senhas não coincidem')
    }

    setLoading(true)
    try {
      const r = isSetup
        ? await api.authSetup(cleanUser, password)
        : await api.authLogin(cleanUser, password)
      try {
        localStorage.setItem(REMEMBER_USER_KEY, cleanUser)
      } catch {
        /* ignore storage errors */
      }
      onSuccess(r.user)
    } catch (err) {
      setError(String((err as Error).message || err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col justify-between overflow-hidden bg-background px-4 py-6 sm:px-6 lg:px-10">
      {/* Ambient Cyber-Telemetry Glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 size-[560px] -translate-x-1/2 rounded-full bg-cyan-500/12 blur-[140px]" />
        <div className="absolute -bottom-44 left-10 size-[460px] rounded-full bg-emerald-500/10 blur-[130px]" />
        <div className="absolute top-1/4 -right-24 size-[480px] rounded-full bg-violet-600/12 blur-[140px]" />
      </div>

      {/* Top Telemetry Status Bar */}
      <header className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/15 bg-card/65 px-4 py-2.5 backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <img
            src="/logo-mark.png"
            alt="Linux Resource"
            width={28}
            height={28}
            className="size-7 rounded-md object-cover ring-1 ring-cyan-400/30"
          />
          <span className="text-sm font-semibold tracking-tight">Linux Resource</span>
          <span className="hidden items-center gap-1 rounded border border-cyan-400/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-cyan-300 uppercase sm:inline-flex">
            <Terminal className="size-2.5" /> Mission Control v{APP_VERSION}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
          {host ? (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-cyan-300">
                <Server className="size-3 text-cyan-400" />
                {host.hostname}
              </span>
              <span className="hidden rounded-md border border-white/10 bg-black/30 px-2 py-0.5 md:inline-flex">
                {host.platform} · {host.arch}
              </span>
              <span className="hidden items-center gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-0.5 sm:inline-flex">
                <Cpu className="size-3 text-violet-400" />
                {host.ncpu} vCPU
              </span>
              {host.gpu && (
                <span className="hidden items-center gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-cyan-300 md:inline-flex">
                  <Gpu className="size-3 text-cyan-400" />
                  {host.gpu.name}
                </span>
              )}
              <span className="hidden items-center gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-0.5 lg:inline-flex">
                <Radio className="size-3 text-sky-400" />
                up {formatDuration(host.uptime)}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">conectando ao host…</span>
          )}
          <Badge
            variant="outline"
            className="h-6 gap-1.5 border-emerald-500/30 bg-emerald-500/10 px-2 font-mono text-[10px] text-emerald-300"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            TELEMETRIA ONLINE
          </Badge>
        </div>
      </header>

      {/* Main Split Content */}
      <main className="relative z-10 mx-auto my-auto grid w-full max-w-6xl items-center gap-8 py-8 lg:grid-cols-[1.12fr_440px] lg:gap-12">
        {/* Left Column: Brand & Mission Control Capabilities */}
        <div className="order-2 flex flex-col justify-center space-y-6 lg:order-1">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="relative shrink-0">
              <div className="absolute -inset-2 rounded-2xl bg-cyan-500/20 blur-xl" />
              <img
                src="/Logo Linux Resource com Tux e Monitor.png"
                alt="Linux Resource"
                width={112}
                height={112}
                className="relative size-24 rounded-2xl border border-cyan-400/25 bg-card/80 object-contain p-1.5 shadow-xl sm:size-28"
              />
            </div>
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-0.5 font-mono text-[10px] font-medium tracking-wider text-cyan-300 uppercase">
                <Activity className="size-3" /> Console de Operações & Telemetria Linux
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                 Controle total do seu ambiente Linux em uma única tela.
              </h2>
              <p className="max-w-xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
                Inspeção direta de kernel via <code className="font-mono text-cyan-300">/proc</code> e{' '}
                <code className="font-mono text-cyan-300">/sys</code>, orquestração Docker, clusters SSH com auditoria e
                gerenciamento de usuários do sistema operacional.
              </p>
            </div>
          </div>

          {/* Feature Grid */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {MODULES.map((m) => {
              const Icon = m.icon
              return (
                <div
                  key={m.title}
                  className="group flex items-start gap-3 rounded-xl border border-cyan-500/12 bg-card/55 p-3 backdrop-blur-md transition-colors hover:border-cyan-400/30 hover:bg-card/80"
                >
                  <div className={cn('grid size-8 shrink-0 place-items-center rounded-lg ring-1', m.color)}>
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-xs font-semibold text-foreground">{m.title}</div>
                    <p className="text-[11px] leading-snug text-muted-foreground">{m.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Column: Authentication Card */}
        <div className="order-1 w-full max-w-md justify-self-center lg:order-2 lg:max-w-none">
          <Card className="relative overflow-hidden border-cyan-500/25 bg-card/80 shadow-[0_20px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-cyan-400/60 before:to-transparent">
            <CardContent className="p-6 sm:p-7">
              <div className="mb-6 flex items-center gap-3.5">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/30 shadow-[0_0_20px_rgba(34,211,238,0.15)]">
                  {isSetup ? <UserPlus className="size-5" /> : <ShieldCheck className="size-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h1 className="text-base leading-tight font-semibold tracking-tight">
                      {isSetup ? 'Configuração Inicial' : 'Autenticação do Console'}
                    </h1>
                    <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 font-mono text-[10px] text-cyan-300">
                      {isSetup ? 'SETUP' : 'ADMIN'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {isSetup
                      ? 'Crie a conta administrativa principal para proteger o painel.'
                      : `Identifique-se para acessar ${host?.hostname || 'o servidor'}.`}
                  </p>
                </div>
              </div>

              <form onSubmit={submit} className="space-y-4">
                <Field
                  icon={<User className="size-4" />}
                  label="Usuário"
                  rightHint={
                    username.trim().length > 0 ? (
                      <span className="font-mono text-[10px] text-cyan-400/80">@{username.trim()}</span>
                    ) : null
                  }
                >
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ex: admin ou raony"
                    autoComplete="username"
                    autoFocus={!username}
                    className="h-10 pl-9 font-mono text-sm"
                    disabled={loading}
                  />
                </Field>

                <Field
                  icon={<KeyRound className="size-4" />}
                  label="Senha"
                  rightHint={
                    capsLock ? (
                      <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-300">
                        <TriangleAlert className="size-3" /> CAPS LOCK ATIVO
                      </span>
                    ) : null
                  }
                >
                  <Input
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKeyEvent}
                    onKeyUp={handleKeyEvent}
                    placeholder={isSetup ? 'mínimo 8 caracteres, letras e números' : '••••••••••••'}
                    autoComplete={isSetup ? 'new-password' : 'current-password'}
                    autoFocus={!!username && !isSetup}
                    className="h-10 pr-10 pl-9 font-mono text-sm"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute inset-y-0 right-1 z-10 flex w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                    tabIndex={-1}
                  >
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </Field>

                {isSetup && (
                  <>
                    <Field icon={<KeyRound className="size-4" />} label="Confirmar senha">
                      <Input
                        type={show ? 'text' : 'password'}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        onKeyDown={handleKeyEvent}
                        onKeyUp={handleKeyEvent}
                        placeholder="repita a senha"
                        autoComplete="new-password"
                        className="h-10 pl-9 font-mono text-sm"
                        disabled={loading}
                      />
                    </Field>

                    {/* Password Strength & Checklist */}
                    <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-mono text-muted-foreground uppercase">Força da credencial</span>
                        <span
                          className={cn(
                            'font-mono font-semibold',
                            strengthScore <= 1
                              ? 'text-rose-400'
                              : strengthScore === 2
                                ? 'text-amber-400'
                                : 'text-emerald-400',
                          )}
                        >
                          {strengthScore === 0
                            ? 'Aguardando'
                            : strengthScore === 1
                              ? 'Fraca'
                              : strengthScore === 2
                                ? 'Média'
                                : strengthScore === 3
                                  ? 'Forte'
                                  : 'Excelente'}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[1, 2, 3, 4].map((lvl) => (
                          <div
                            key={lvl}
                            className={cn(
                              'h-1 rounded-full transition-colors',
                              strengthScore >= lvl
                                ? strengthScore <= 1
                                  ? 'bg-rose-500'
                                  : strengthScore === 2
                                    ? 'bg-amber-400'
                                    : 'bg-emerald-400'
                                : 'bg-white/10',
                            )}
                          />
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
                        <ReqItem ok={checks.userLen} label="Usuário (3–32 chars)" />
                        <ReqItem ok={checks.passLen} label="Mínimo 8 caracteres" />
                        <ReqItem ok={checks.passMix} label="Letras e números" />
                        <ReqItem ok={checks.passMatch} label="Senhas coincidem" />
                      </div>
                    </div>
                  </>
                )}

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="h-10 w-full gap-2 font-medium shadow-[0_0_25px_rgba(6,182,212,0.25)]"
                  disabled={loading || !username.trim() || !password || (isSetup && !confirm)}
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isSetup ? (
                    <UserPlus className="size-4" />
                  ) : (
                    <LogIn className="size-4" />
                  )}
                  {loading
                    ? 'Verificando credenciais…'
                    : isSetup
                      ? 'Criar administrador e iniciar'
                      : 'Acessar Mission Control'}
                </Button>
              </form>

              {/* Security Specification Footer inside Card */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-4 font-mono text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="size-3 text-emerald-400" /> Cookie HttpOnly · SameSite=Lax
                </span>
                <span>scrypt (N=16384) + AES-256-GCM</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Bottom Subtle Footer */}
      <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono">
          Linux Resource // Telemetria local protegida por sessão criptografada no SQLite
        </span>
        <span className="font-mono text-cyan-300/80">
          {host ? `${host.hostname} (${host.platform})` : ' Porta padrão 10450'}
        </span>
      </footer>
    </div>
  )
}

function ReqItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={cn('flex items-center gap-1.5', ok ? 'text-emerald-300' : 'text-muted-foreground')}>
      <span
        className={cn(
          'grid size-3.5 shrink-0 place-items-center rounded-full border',
          ok ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300' : 'border-white/15 bg-white/5',
        )}
      >
        {ok && <Check className="size-2.5" />}
      </span>
      <span className="truncate">{label}</span>
    </div>
  )
}

function Field({
  icon,
  label,
  rightHint,
  children,
}: {
  icon: React.ReactNode
  label: string
  rightHint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block text-xs font-medium text-muted-foreground">{label}</label>
        {rightHint}
      </div>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-9 items-center justify-center text-muted-foreground">
          {icon}
        </span>
        {children}
      </div>
    </div>
  )
}
