import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Boxes,
  Check,
  Folder,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  TriangleAlert,
  User,
  UserPlus,
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
import { api, type OsUser, type OsUsersOverview } from '@/lib/api'
import { relTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const selectCls =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

const COMMON_GROUPS = ['sudo', 'docker', 'adm', 'users', 'plugdev', 'netdev', 'audio', 'video', 'www-data', 'systemd-journal']

export function SudoConfigModal({
  open,
  onOpenChange,
  defaultUser,
  humanUsers,
  hasSavedPassword,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultUser: string
  humanUsers: { username: string; uid: number; isSudoer: boolean }[]
  hasSavedPassword: boolean
  onSaved: () => void
}) {
  const [username, setUsername] = useState(defaultUser || 'raony')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUsername(defaultUser || humanUsers.find((u) => u.isSudoer && u.uid >= 1000)?.username || 'raony')
    setPassword('')
    setError(null)
    setBusy(false)
  }, [open, defaultUser, humanUsers])

  async function submit() {
    if (!username.trim()) return setError('Selecione ou digite o usuário administrador.')
    if (!password) return setError('Digite a senha sudo do usuário no Linux.')
    setBusy(true)
    setError(null)
    try {
      await api.osConfigureSudo(username.trim(), password)
      toast.success(`Credencial sudo validada para "${username.trim()}" e salva no cofre!`)
      onOpenChange(false)
      onSaved()
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  async function clearVault() {
    setBusy(true)
    setError(null)
    try {
      await api.osClearSudo()
      toast.info('Credencial sudo removida do cofre.')
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
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-cyan-400" /> Cofre de Elevação Sudo (Linux)
          </AlertDialogTitle>
          <AlertDialogDescription>
            Informe o usuário e a senha <span className="font-mono text-foreground">sudo</span> do sistema operacional.
            A senha é testada no host e armazenada criptografada com <span className="font-mono">AES-256-GCM</span> para
            autorizar gerência de usuários e tarefas de limpeza.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 py-1">
          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            Usuário com permissão sudo
            {humanUsers.length > 0 ? (
              <select className={selectCls} value={username} onChange={(e) => setUsername(e.target.value)}>
                {humanUsers.map((u) => (
                  <option key={u.username} value={u.username}>
                    {u.username} (UID {u.uid}){u.isSudoer ? ' · sudo' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="raony" />
            )}
          </label>

          <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
            Senha do usuário no Linux (sudo)
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite a senha do usuário no SO"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
            />
          </label>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <AlertDialogFooter className="flex-wrap gap-2 sm:justify-between">
          {hasSavedPassword ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              className="text-muted-foreground hover:text-destructive"
              onClick={clearVault}
            >
              <Trash2 className="size-3.5" /> Remover do cofre
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Validar e Salvar
            </AlertDialogAction>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function OsUserDialog({
  open,
  onOpenChange,
  editing,
  shells,
  availableGroups,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: OsUser | null
  shells: string[]
  availableGroups: string[]
  onSaved: (next: OsUsersOverview) => void
}) {
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [shell, setShell] = useState('/bin/bash')
  const [password, setPassword] = useState('')
  const [createHome, setCreateHome] = useState(true)
  const [locked, setLocked] = useState(false)
  const [groups, setGroups] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setBusy(false)
    setPassword('')
    if (editing) {
      setUsername(editing.username)
      setFullName(editing.fullName || '')
      setShell(editing.shell || '/bin/bash')
      setLocked(editing.locked)
      setGroups(new Set(editing.groups))
      setCreateHome(true)
    } else {
      setUsername('')
      setFullName('')
      setShell(shells.includes('/bin/bash') ? '/bin/bash' : shells[0] || '/bin/sh')
      setLocked(false)
      setGroups(new Set(['users']))
      setCreateHome(true)
    }
  }, [open, editing, shells])

  const groupOptions = useMemo(() => {
    const merged = new Set([...COMMON_GROUPS, ...availableGroups, ...Array.from(groups)])
    return Array.from(merged).sort()
  }, [availableGroups, groups])

  function toggleGroup(g: string) {
    setGroups((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

  async function submit() {
    setError(null)
    if (!editing && !username.trim()) return setError('Informe o nome de usuário (login).')
    if (!editing && password.length < 4) return setError('Informe uma senha inicial (mínimo 4 caracteres).')
    if (editing && password && password.length < 4) return setError('A nova senha precisa ter pelo menos 4 caracteres.')

    setBusy(true)
    try {
      let next: OsUsersOverview
      if (editing) {
        next = await api.osUpdateUser({
          username: editing.username,
          fullName: fullName.trim(),
          shell,
          password: password || undefined,
          groups: Array.from(groups),
          locked,
        })
        toast.success(`Usuário "${editing.username}" atualizado!`)
      } else {
        next = await api.osCreateUser({
          username: username.trim().toLowerCase(),
          fullName: fullName.trim(),
          shell,
          password,
          groups: Array.from(groups),
          createHome,
        })
        toast.success(`Usuário "${username.trim().toLowerCase()}" criado no sistema!`)
      }
      onOpenChange(false)
      onSaved(next)
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
            {editing ? (
              <>
                <Pencil className="size-4 text-cyan-400" /> Editar usuário: {editing.username}
              </>
            ) : (
              <>
                <UserPlus className="size-4 text-emerald-400" /> Novo usuário do Sistema Operacional
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {editing
              ? 'Altere nome completo, shell padrão, grupos suplementares (como sudo e docker) ou redefina a senha.'
              : 'Cria uma conta real no Linux (/etc/passwd e /etc/shadow) usando useradd.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Login (username)
              <Input
                value={username}
                disabled={!!editing}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="joao"
                className="font-mono"
                autoFocus={!editing}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Nome completo / Descrição
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="João Silva" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              Shell de Login
              <select className={cn(selectCls, 'font-mono text-xs')} value={shell} onChange={(e) => setShell(e.target.value)}>
                {shells.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
              {editing ? 'Nova senha (opcional)' : 'Senha inicial'}
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={editing ? 'deixe vazio para manter' : 'mínimo 4 caracteres'}
                autoComplete="new-password"
              />
            </label>
          </div>

          {!editing && (
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <Checkbox checked={createHome} onCheckedChange={(c) => setCreateHome(Boolean(c))} />
              <span>
                Criar diretório pessoal automaticamente (<span className="font-mono">/home/{username || 'usuario'}</span>)
              </span>
            </label>
          )}

          {editing && editing.uid !== 0 && (
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
              <Checkbox checked={locked} onCheckedChange={(c) => setLocked(Boolean(c))} />
              <span>Bloquear login por senha desta conta (`usermod -L`)</span>
            </label>
          )}

          {(!editing || editing.uid !== 0) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                <span>Grupos Suplementares (Permissões)</span>
                <span className="font-mono text-[10px] text-cyan-400">{groups.size} selecionado(s)</span>
              </div>
              <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/20 p-2.5 max-h-36 overflow-y-auto">
                {groupOptions.map((g) => {
                  const active = groups.has(g)
                  const isSpecial = g === 'sudo' || g === 'wheel' || g === 'docker'
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => toggleGroup(g)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors',
                        active
                          ? isSpecial
                            ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                            : 'border-cyan-500/50 bg-cyan-500/20 text-cyan-300'
                          : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {active && <Check className="size-2.5" />}
                      {g}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
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
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} {editing ? 'Salvar alterações' : 'Criar usuário'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function OsUsersPanel() {
  const [data, setData] = useState<OsUsersOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [sudoOpen, setSudoOpen] = useState(false)
  const [userDialogOpen, setUserDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<OsUser | null>(null)
  const [deletingUser, setDeletingUser] = useState<OsUser | null>(null)
  const [removeHome, setRemoveHome] = useState(false)
  const [deletingBusy, setDeletingBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.osUsers()
      setData(d)
    } catch (e) {
      toast.error('Falha ao carregar usuários do sistema', { description: String((e as Error).message || e) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const allUsers = data?.users ?? []
  const humanCount = allUsers.filter((u) => u.isHuman).length
  const sudoersCount = allUsers.filter((u) => u.isHuman && u.isSudoer).length
  const systemCount = allUsers.filter((u) => !u.isHuman).length
  const sudo = data?.sudo

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allUsers.filter((u) => {
      if (!showSystem && !u.isHuman) return false
      if (!q) return true
      return (
        u.username.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        u.home.toLowerCase().includes(q) ||
        u.shell.toLowerCase().includes(q) ||
        String(u.uid).includes(q) ||
        u.allGroups.some((g) => g.toLowerCase().includes(q))
      )
    })
  }, [allUsers, showSystem, search])

  async function confirmDelete() {
    if (!deletingUser) return
    setDeletingBusy(true)
    try {
      const next = await api.osDeleteUser(deletingUser.username, removeHome)
      setData(next)
      toast.success(`Usuário "${deletingUser.username}" removido do sistema.`)
      setDeletingUser(null)
    } catch (e) {
      toast.error(String((e as Error).message || e))
    } finally {
      setDeletingBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Elevação Sudo (Host)"
          value={
            sudo?.canSudo
              ? sudo.method === 'vault'
                ? `Cofre (${sudo.configuredUser})`
                : sudo.method === 'root'
                  ? 'Root nativo'
                  : 'Sem senha'
              : 'Requer senha'
          }
          hint={
            sudo?.canSudo
              ? sudo.updatedAt
                ? `validado ${relTime(sudo.updatedAt)} · pronto para uso`
                : 'privilégio administrativo ativo'
              : 'clique em Configurar Sudo abaixo'
          }
          icon={
            sudo?.canSudo ? (
              <ShieldCheck className="size-4 text-emerald-400" />
            ) : (
              <ShieldAlert className="size-4 text-amber-400" />
            )
          }
        />

        <StatCard
          label="Usuários do Sistema"
          value={loading && !data ? '—' : `${humanCount} humanos`}
          hint={`${sudoersCount} com sudo · ${allUsers.filter((u) => u.loggedIn).length} com sessão ativa`}
          icon={<User className="size-4 text-cyan-400" />}
        />

        <StatCard
          label="Contas de Serviço"
          value={loading && !data ? '—' : `${systemCount} daemons`}
          hint={`${data?.groups.length ?? 0} grupos em /etc/group`}
          icon={<Boxes className="size-4 text-violet-400" />}
        />
      </div>

      {/* Sudo Credential Banner */}
      <Card size="sm" className={cn(sudo?.canSudo ? 'border-emerald-500/25' : 'border-amber-500/35 bg-amber-500/5')}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className={cn('size-4', sudo?.canSudo ? 'text-emerald-400' : 'text-amber-400')} />
            Credencial Sudo do Sistema Operacional
            <Badge
              variant="outline"
              className={cn(
                'h-4 px-1.5 font-mono text-[10px]',
                sudo?.canSudo ? 'border-emerald-500/40 text-emerald-400' : 'border-amber-500/40 text-amber-300'
              )}
            >
              {sudo?.canSudo ? 'AUTENTICADO' : 'PENDENTE'}
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            {sudo?.canSudo
              ? `Operações privilegiadas (criar/editar/remover usuários do Linux e executar limpezas com sudo) estão habilitadas via "${sudo.configuredUser}".`
              : 'Configure a senha sudo do seu usuário Linux no cofre criptografado (AES-256-GCM) para liberar o CRUD de usuários do SO e a aba Limpeza.'}
          </CardDescription>
          <CardAction>
            <Button variant={sudo?.canSudo ? 'outline' : 'default'} size="sm" onClick={() => setSudoOpen(true)}>
              <KeyRound className="size-3.5" /> {sudo?.canSudo ? 'Alterar Sudo' : 'Configurar Sudo'}
            </Button>
          </CardAction>
        </CardHeader>
      </Card>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar usuário, UID, grupo, shell…"
            className="h-8 pl-8 font-mono text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <Button
          variant={showSystem ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowSystem((v) => !v)}
          className="font-mono text-xs"
        >
          {showSystem ? `Ocultar daemons (${systemCount})` : `Mostrar contas de sistema (+${systemCount})`}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /> Atualizar
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (!sudo?.canSudo) {
                toast.info('Configure primeiro a senha sudo para criar usuários no sistema operacional.')
                setSudoOpen(true)
                return
              }
              setEditingUser(null)
              setUserDialogOpen(true)
            }}
          >
            <Plus className="size-4" /> Novo usuário
          </Button>
        </div>
      </div>

      {/* Users Grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((u) => {
          const isPrimaryHostUser = u.username === sudo?.configuredUser || u.uid === 0
          return (
            <Card key={u.username} size="sm" className="gap-2.5 transition-colors hover:border-cyan-400/35">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 font-mono text-sm">
                  <span
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-md border',
                      u.isSudoer
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                        : 'border-border bg-muted/40 text-muted-foreground'
                    )}
                  >
                    {u.locked ? <Lock className="size-3.5 text-amber-400" /> : <User className="size-3.5" />}
                  </span>
                  <span className="truncate">{u.username}</span>
                  <Badge variant="outline" className="h-4 px-1.5 font-mono text-[10px] text-muted-foreground">
                    UID {u.uid}
                  </Badge>
                  {u.loggedIn && (
                    <Badge variant="outline" className="h-4 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[9px] text-emerald-400">
                      ONLINE
                    </Badge>
                  )}
                  {u.locked && (
                    <Badge variant="outline" className="h-4 border-amber-500/40 bg-amber-500/10 px-1.5 text-[9px] text-amber-300">
                      BLOQUEADO
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="truncate text-xs">
                  {u.fullName || (u.isHuman ? 'Usuário do sistema' : 'Conta de serviço / daemon')}
                </CardDescription>
                <CardAction className="flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Editar usuário"
                    onClick={() => {
                      if (!sudo?.canSudo) {
                        toast.info('Configure primeiro a senha sudo para editar usuários.')
                        setSudoOpen(true)
                        return
                      }
                      setEditingUser(u)
                      setUserDialogOpen(true)
                    }}
                  >
                    <Pencil />
                  </Button>
                  {u.uid >= 1000 && !isPrimaryHostUser && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Remover usuário"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (!sudo?.canSudo) {
                          toast.info('Configure primeiro a senha sudo para remover usuários.')
                          setSudoOpen(true)
                          return
                        }
                        setRemoveHome(false)
                        setDeletingUser(u)
                      }}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </CardAction>
              </CardHeader>

              <CardContent className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2 rounded-lg border bg-card/40 px-2.5 py-1.5 font-mono text-[11px]">
                  <div className="flex items-center gap-1.5 truncate" title={u.home}>
                    <Folder className="size-3 shrink-0 text-cyan-400" />
                    <span className="truncate">{u.home}</span>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 truncate text-muted-foreground" title={u.shell}>
                    <Terminal className="size-3 shrink-0" />
                    <span className="truncate">{u.shell}</span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {u.uid === 0 && (
                    <Badge variant="outline" className="h-4 border-rose-500/40 bg-rose-500/10 px-1.5 font-mono text-[9px] text-rose-300">
                      ROOT
                    </Badge>
                  )}
                  {u.isSudoer && u.uid !== 0 && (
                    <Badge variant="outline" className="h-4 border-emerald-500/40 bg-emerald-500/10 px-1.5 font-mono text-[9px] text-emerald-300">
                      SUDO
                    </Badge>
                  )}
                  {u.isDocker && (
                    <Badge variant="outline" className="h-4 border-sky-500/40 bg-sky-500/10 px-1.5 font-mono text-[9px] text-sky-300">
                      DOCKER
                    </Badge>
                  )}
                  {u.allGroups
                    .filter((g) => g !== 'sudo' && g !== 'wheel' && g !== 'docker')
                    .slice(0, 6)
                    .map((g) => (
                      <Badge key={g} variant="secondary" className="h-4 px-1.5 font-mono text-[9px]">
                        {g}
                      </Badge>
                    ))}
                  {u.allGroups.length > 7 && (
                    <span className="font-mono text-[10px] text-muted-foreground">+{u.allGroups.length - 7}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <SudoConfigModal
        open={sudoOpen}
        onOpenChange={setSudoOpen}
        defaultUser={sudo?.configuredUser || 'raony'}
        humanUsers={sudo?.humanUsers ?? []}
        hasSavedPassword={!!sudo?.hasSavedPassword}
        onSaved={load}
      />

      <OsUserDialog
        open={userDialogOpen}
        onOpenChange={setUserDialogOpen}
        editing={editingUser}
        shells={data?.shells ?? ['/bin/bash', '/bin/sh', '/usr/sbin/nologin']}
        availableGroups={(data?.groups ?? []).map((g) => g.name)}
        onSaved={(next) => setData(next)}
      />

      <AlertDialog open={!!deletingUser} onOpenChange={(v) => !v && setDeletingUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-destructive" /> Remover usuário {deletingUser?.username}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A conta <span className="font-mono font-semibold text-foreground">{deletingUser?.username}</span> (UID{' '}
              {deletingUser?.uid}) será removida do sistema operacional via <span className="font-mono">userdel</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
            <Checkbox checked={removeHome} onCheckedChange={(c) => setRemoveHome(Boolean(c))} />
            <span>
              Apagar também o diretório pessoal (<span className="font-mono">{deletingUser?.home}</span>) e arquivos (
              <span className="font-mono">userdel -r</span>)
            </span>
          </label>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingBusy}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {deletingBusy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Remover conta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
