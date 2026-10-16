import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, LogIn, ShieldCheck, User, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { AuthUser } from '@/lib/api'
import { cn } from 'cn'

type Mode = 'login' | 'setup'

export function LoginScreen({ mode, onSuccess }: { mode: Mode; onSuccess: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isSetup = mode === 'setup'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (isSetup) {
      if (password !== confirm) return setError('as senhas não coincidem')
      if (username.trim().length < 3) return setError('o usuário precisa ter ao menos 3 caracteres')
      if (password.length < 8) return setError('a senha precisa ter ao menos 8 caracteres')
    }

    setLoading(true)
    try {
      const r = isSetup
        ? await api.authSetup(username.trim(), password)
        : await api.authLogin(username.trim(), password)
      onSuccess(r.user)
    } catch (err) {
      setError(String((err as Error).message || err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[120px]" />
        <div className="absolute -bottom-40 -left-20 size-[420px] rounded-full bg-violet-600/15 blur-[120px]" />
        <div className="absolute -right-24 top-1/3 size-[380px] rounded-full bg-sky-500/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <img
            src="/Logo Linux Resource com Tux e Monitor.png"
            alt="Linux Resource"
            width={320}
            height={320}
            className="w-64 sm:w-72"
          />
        </div>

        <Card className="border-border/60 bg-card/70 shadow-2xl backdrop-blur">
          <CardContent className="pt-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/25">
                {isSetup ? <UserPlus className="size-5" /> : <ShieldCheck className="size-5" />}
              </div>
              <div>
                <h1 className="text-base leading-tight font-semibold">
                  {isSetup ? 'Configuração inicial' : 'Acesso restrito'}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {isSetup
                    ? 'Crie o usuário administrador para começar.'
                    : 'Entre com seu usuário e senha para continuar.'}
                </p>
              </div>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <Field icon={<User className="size-4" />} label="Usuário">
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="seu usuário"
                  autoComplete="username"
                  autoFocus
                  className="pl-9"
                  disabled={loading}
                />
              </Field>

              <Field icon={<KeyRound className="size-4" />} label="Senha">
                <Input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSetup ? 'mínimo 8 caracteres, letras e números' : 'sua senha'}
                  autoComplete={isSetup ? 'new-password' : 'current-password'}
                  className="pr-10 pl-9"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                  tabIndex={-1}
                >
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </Field>

              {isSetup && (
                <Field icon={<KeyRound className="size-4" />} label="Confirmar senha">
                  <Input
                    type={show ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="repita a senha"
                    autoComplete="new-password"
                    className="pl-9"
                    disabled={loading}
                  />
                </Field>
              )}

              {error && (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading || !username || !password}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : isSetup ? <UserPlus className="size-4" /> : <LogIn className="size-4" />}
                {isSetup ? 'Criar administrador e entrar' : 'Entrar'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
          Sessão protegida por cookie <span className="font-mono">HttpOnly</span> · senhas com{' '}
          <span className="font-mono">scrypt</span> + salt · usuários no SQLite local
        </p>
      </div>
    </div>
  )
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      <div className={cn('relative', '[&>svg:first-child]:absolute [&>svg:first-child]:top-1/2 [&>svg:first-child]:left-3 [&>svg:first-child]:-translate-y-1/2 [&>svg:first-child]:text-muted-foreground')}>
        {icon}
        {children}
      </div>
    </div>
  )
}
