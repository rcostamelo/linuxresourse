import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  User,
  UserPlus,
} from '@/components/ui/lucide-animated'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { AuthUser, PanelRole, PanelSession, PanelUser, PanelUsersOverview } from '@/lib/api'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'

function formatBrowserUa(ua: string | null): string {
  if (!ua) return 'Dispositivo desconhecido'
  let browser = 'Navegador'
  if (ua.includes('Edg/')) browser = 'Edge'
  else if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari'
  else if (ua.includes('curl/')) browser = 'curl CLI'

  let os = ''
  if (ua.includes('Linux')) os = 'Linux'
  else if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac OS')) os = 'macOS'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'

  return os ? `${browser} · ${os}` : browser
}

export function PanelUsersModal({
  open,
  onOpenChange,
  currentUser,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  currentUser: AuthUser
}) {
  const [data, setData] = useState<PanelUsersOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'users' | 'sessions'>('users')

  // Create / Edit state
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PanelUser | null>(null)
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<PanelRole>('admin')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<PanelUser | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const isAdmin = currentUser.role !== 'viewer'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.panelUsersOverview()
      setData(res)
    } catch (e) {
      toast.error('Falha ao carregar usuários do gerenciador', {
        description: String((e as Error).message || e),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      load()
      setFormOpen(false)
      setDeleteTarget(null)
    }
  }, [open, load])

  function openCreate() {
    setEditing(null)
    setUsername('')
    setRole('admin')
    setPassword('')
    setShowPass(false)
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(u: PanelUser) {
    setEditing(u)
    setUsername(u.username)
    setRole(u.role)
    setPassword('')
    setShowPass(false)
    setFormError(null)
    setFormOpen(true)
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSaving(true)
    try {
      if (editing) {
        const res = await api.panelUpdateUser({
          id: editing.id,
          role,
          password: password.trim() ? password : undefined,
        })
        setData(res)
        toast.success(`Usuário "${editing.username}" atualizado`)
      } else {
        const res = await api.panelCreateUser({
          username: username.trim(),
          password,
          role,
        })
        setData(res)
        toast.success(`Usuário "${username.trim()}" criado no gerenciador`)
      }
      setFormOpen(false)
    } catch (err) {
      setFormError(String((err as Error).message || err))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const target = deleteTarget
    setBusyId(`del-${target.id}`)
    try {
      const res = await api.panelDeleteUser(target.id)
      setData(res)
      setDeleteTarget(null)
      toast.success(`Usuário "${target.username}" removido`)
    } catch (e) {
      toast.error(String((e as Error).message || e))
    } finally {
      setBusyId(null)
    }
  }

  async function revokeSession(s: PanelSession) {
    setBusyId(`sess-${s.tokenPrefix}`)
    try {
      const res = await api.panelRevokeSession(s.tokenPrefix)
      setData(res)
      toast.success(`Sessão de ${s.username} encerrada`)
    } catch (e) {
      toast.error(String((e as Error).message || e))
    } finally {
      setBusyId(null)
    }
  }

  async function revokeOtherSessions() {
    setBusyId('revoke-others')
    try {
      const res = await api.panelRevokeOtherSessions()
      setData(res)
      toast.success('Todas as outras sessões foram encerradas')
    } catch (e) {
      toast.error(String((e as Error).message || e))
    } finally {
      setBusyId(null)
    }
  }

  const users = data?.users ?? []
  const sessions = data?.sessions ?? []
  const otherSessionsCount = sessions.filter((s) => !s.current).length

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[88vh] overflow-hidden sm:max-w-2xl">
        <AlertDialogHeader>
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4.5 text-cyan-400" />
              Usuários & Sessões do Gerenciador
            </AlertDialogTitle>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="xs" onClick={load} disabled={loading}>
                <RefreshCw className={cn('size-3', loading && 'animate-spin')} /> Atualizar
              </Button>
              {isAdmin && tab === 'users' && !formOpen && (
                <Button size="xs" onClick={openCreate}>
                  <Plus className="size-3.5" /> Novo usuário
                </Button>
              )}
            </div>
          </div>
          <AlertDialogDescription className="text-xs">
            Gerencie quem pode acessar o painel web <b>Linux Resource</b>, níveis de permissão (
            <span className="font-mono text-cyan-300">admin</span> ou{' '}
            <span className="font-mono text-amber-300">viewer</span>) e sessões conectadas.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Sub-navigation Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setTab('users')
                setFormOpen(false)
              }}
              className={cn(
                'inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors',
                tab === 'users'
                  ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
              )}
            >
              <User className="size-3.5" />
              Contas do Painel
              <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">
                {users.length}
              </Badge>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('sessions')
                setFormOpen(false)
              }}
              className={cn(
                'inline-flex shrink-0 whitespace-nowrap items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors',
                tab === 'sessions'
                  ? 'bg-cyan-500/15 text-cyan-200 ring-1 ring-cyan-400/30'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
              )}
            >
              <KeyRound className="size-3.5" />
              Sessões Ativas
              <Badge variant="secondary" className="ml-0.5 h-4 px-1.5 text-[10px]">
                {sessions.length}
              </Badge>
            </button>
          </div>

          {tab === 'sessions' && otherSessionsCount > 0 && (
            <Button
              variant="outline"
              size="xs"
              className="text-rose-400 hover:text-rose-300"
              disabled={busyId === 'revoke-others'}
              onClick={revokeOtherSessions}
            >
              {busyId === 'revoke-others' ? <Loader2 className="size-3 animate-spin" /> : <LogOut className="size-3" />}
              Encerrar outras ({otherSessionsCount})
            </Button>
          )}
        </div>

        {/* Body */}
        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {!isAdmin && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              <ShieldAlert className="size-4 shrink-0" />
              <span>
                Sua conta tem perfil <b>Visualizador (somente leitura)</b>. Apenas administradores podem criar ou alterar
                contas do painel.
              </span>
            </div>
          )}

          {/* Create / Edit Sub-form */}
          {formOpen && (
            <form
              onSubmit={submitForm}
              className="space-y-3 rounded-xl border border-cyan-400/30 bg-card/90 p-4 shadow-lg"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300 uppercase font-mono">
                  {editing ? <Pencil className="size-3.5" /> : <UserPlus className="size-3.5" />}
                  {editing ? `Editar conta: ${editing.username}` : 'Nova conta do gerenciador'}
                </div>
                <Button type="button" variant="ghost" size="xs" onClick={() => setFormOpen(false)}>
                  Cancelar
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-medium text-muted-foreground">
                  Usuário
                  <Input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ex: operador"
                    disabled={!!editing || saving}
                    className="font-mono"
                    autoFocus={!editing}
                  />
                </label>

                <div className="space-y-1">
                  <span className="block text-xs font-medium text-muted-foreground">Perfil de permissão</span>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={role === 'admin' ? 'secondary' : 'outline'}
                      className={cn(role === 'admin' && 'border-cyan-400/40 text-cyan-300')}
                      onClick={() => setRole('admin')}
                      disabled={saving}
                    >
                      <ShieldCheck className="size-3.5" /> Admin
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={role === 'viewer' ? 'secondary' : 'outline'}
                      className={cn(role === 'viewer' && 'border-amber-400/40 text-amber-300')}
                      onClick={() => setRole('viewer')}
                      disabled={saving}
                    >
                      <Eye className="size-3.5" /> Viewer
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <span className="block text-xs font-medium text-muted-foreground">
                  {editing ? 'Redefinir senha (deixe em branco para manter a atual)' : 'Senha de acesso (mín. 8 chars, letras e números)'}
                </span>
                <div className="relative flex items-center">
                  <span className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-9 items-center justify-center text-muted-foreground">
                    <Lock className="size-3.5" />
                  </span>
                  <Input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editing ? 'nova senha opcional…' : 'mínimo 8 caracteres, letras e números'}
                    className="pr-9 pl-9 font-mono"
                    disabled={saving}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute inset-y-0 right-1 z-10 flex w-8 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPass ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-muted-foreground">
                {role === 'admin' ? (
                  <>
                    <b className="text-cyan-300">Administrador (admin):</b> acesso total a telemetria, Docker, servidores
                    SSH, runbooks, limpeza e gerenciamento de usuários.
                  </>
                ) : (
                  <>
                    <b className="text-amber-300">Visualizador (viewer):</b> pode visualizar todas as abas e métricas em
                    tempo real, mas não pode executar ações remotas, matar processos, limpar arquivos nem alterar contas.
                  </>
                )}
              </div>

              {formError && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <TriangleAlert className="size-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button type="submit" size="sm" disabled={saving || (!editing && (!username.trim() || !password))}>
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                  {editing ? 'Salvar alterações' : 'Criar conta'}
                </Button>
              </div>
            </form>
          )}

          {/* Delete Confirmation Box */}
          {deleteTarget && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-semibold text-rose-300">
                  <TriangleAlert className="size-4" />
                  Remover usuário "{deleteTarget.username}" do gerenciador?
                </div>
                <p className="text-muted-foreground">
                  Todas as sessões ativas de <span className="font-mono">{deleteTarget.username}</span> serão encerradas
                  imediatamente.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="xs" onClick={() => setDeleteTarget(null)}>
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  disabled={busyId === `del-${deleteTarget.id}`}
                  onClick={confirmDelete}
                >
                  {busyId === `del-${deleteTarget.id}` ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                  Confirmar exclusão
                </Button>
              </div>
            </div>
          )}

          {/* Tab 1: Users List */}
          {tab === 'users' && (
            <div className="space-y-2">
              {users.map((u) => {
                const isSelf = u.id === currentUser.id
                return (
                  <div
                    key={u.id}
                    className={cn(
                      'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 transition-colors',
                      isSelf ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-white/10 bg-card/60',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'grid size-9 shrink-0 place-items-center rounded-lg ring-1',
                          u.role === 'admin'
                            ? 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/30'
                            : 'bg-amber-500/15 text-amber-300 ring-amber-400/30',
                        )}
                      >
                        <User className="size-4" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{u.username}</span>
                          {isSelf && (
                            <Badge variant="outline" className="h-4 border-cyan-400/40 bg-cyan-500/10 px-1.5 font-mono text-[9px] text-cyan-300">
                              VOCÊ
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={cn(
                              'h-4 px-1.5 font-mono text-[9px] uppercase',
                              u.role === 'admin'
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                            )}
                          >
                            {u.role === 'admin' ? 'ADMIN' : 'VIEWER (LEITURA)'}
                          </Badge>
                          {u.activeSessions > 0 && (
                            <Badge variant="secondary" className="h-4 px-1.5 font-mono text-[9px]">
                              {u.activeSessions} {u.activeSessions === 1 ? 'sessão ativa' : 'sessões ativas'}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                          <span>Criado {relTime(u.createdAt)}</span>
                          <span>·</span>
                          <span>
                            Último login: {u.lastLoginAt ? relTime(u.lastLoginAt) : 'nunca'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => openEdit(u)}
                          title="Editar perfil ou redefinir senha"
                        >
                          <Pencil className="size-3" /> Editar
                        </Button>
                        {!isSelf && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground hover:text-destructive"
                            title="Remover usuário"
                            onClick={() => setDeleteTarget(u)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Tab 2: Active Sessions */}
          {tab === 'sessions' && (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div
                  key={s.tokenPrefix}
                  className={cn(
                    'flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3',
                    s.current ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10 bg-card/60',
                  )}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-foreground">{s.username}</span>
                      <Badge variant="outline" className="h-4 px-1.5 font-mono text-[9px] uppercase">
                        {s.role}
                      </Badge>
                      {s.current && (
                        <Badge className="h-4 border-emerald-500/40 bg-emerald-500/15 px-1.5 font-mono text-[9px] text-emerald-300">
                          SESSÃO ATUAL
                        </Badge>
                      )}
                      <span className="font-mono text-[11px] text-cyan-300">
                        {formatBrowserUa(s.userAgent)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                      <span>IP: {s.ip || 'local'}</span>
                      <span>·</span>
                      <span>Iniciada {relTime(s.createdAt)}</span>
                      <span>·</span>
                      <span>Token #{s.tokenPrefix.slice(0, 8)}</span>
                    </div>
                  </div>

                  {!s.current && (isAdmin || s.userId === currentUser.id) && (
                    <Button
                      variant="outline"
                      size="xs"
                      className="text-rose-400 hover:text-rose-300"
                      disabled={busyId === `sess-${s.tokenPrefix}`}
                      onClick={() => revokeSession(s)}
                    >
                      {busyId === `sess-${s.tokenPrefix}` ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <LogOut className="size-3" />
                      )}
                      Encerrar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Fechar</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
