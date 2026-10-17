import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  Eraser,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
} from '@/components/ui/lucide-animated'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'
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
import { SudoConfigModal } from '@/components/OsUsersPanel'
import { api, type CleanRunResult, type CleanTask, type CleanTasksResponse, type OsSudoStatus, type Risk } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

const RISK: Record<Risk, { label: string; className: string }> = {
  low: { label: 'baixo risco', className: 'text-emerald-400 border-emerald-400/40' },
  medium: { label: 'atenção', className: 'text-amber-400 border-amber-400/40' },
  high: { label: 'irreversível', className: 'text-rose-400 border-rose-400/40' },
}

const FALLBACK_CMD: Record<string, string> = {
  thumbs: 'rm -rf ~/.cache/thumbnails/*',
  trash: 'rm -rf ~/.local/share/Trash/files/* ~/.local/share/Trash/info/*',
  'swap-orphans': 'sudo rm -f /swapfile*',
}

function CopyCommand({ command }: { command: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(command).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
      className="group/cmd flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-muted/40 px-2.5 text-left font-mono text-xs transition-colors hover:bg-muted"
      title="Copiar comando"
    >
      <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{command}</span>
      <span className="ml-auto shrink-0 text-muted-foreground">
        {done ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
      </span>
    </button>
  )
}

export function CleanupPanel() {
  const [data, setData] = useState<CleanTasksResponse | null>(null)
  const [sudoStatus, setSudoStatus] = useState<OsSudoStatus | null>(null)
  const [sudoOpen, setSudoOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<CleanTask | null>(null)
  const [running, setRunning] = useState(false)
  const [last, setLast] = useState<CleanRunResult | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, u] = await Promise.all([api.cleanTasks(), api.osUsers().catch(() => null)])
      setData(d)
      if (u?.sudo) setSudoStatus(u.sudo)
      const orphans = d.tasks.find((t) => t.special === 'swap')?.orphans ?? []
      setSelected(new Set(orphans.map((o) => o.path)))
    } catch (e) {
      toast.error('Falha ao carregar tarefas', { description: String((e as Error).message) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const total = useMemo(() => (data?.tasks ?? []).reduce((s, t) => s + t.size, 0), [data])
  const swapTask = data?.tasks.find((t) => t.special === 'swap')
  const orphans = swapTask?.orphans ?? []

  const run = async (task: CleanTask) => {
    setRunning(true)
    try {
      const paths = task.special === 'swap' ? [...selected] : undefined
      const r = await api.cleanRun(task.id, paths)
      setLast(r)
      if (r.needsPassword) {
        toast.error('Precisa de senha (sudo)', { description: `Configure o Cofre Sudo ou rode no terminal: ${r.command}` })
      } else if (r.ok === false || (r.results && r.results.some((x) => !x.ok))) {
        toast.warning('Concluído com falhas', { description: `Liberado: ${formatBytes(r.freed)}` })
      } else {
        toast.success(`Liberado ${formatBytes(r.freed)}`, { description: task.title })
      }
      setConfirm(null)
      await load()
    } catch (e) {
      toast.error('Falha na limpeza', { description: String((e as Error).message) })
    } finally {
      setRunning(false)
    }
  }

  const selectedFreed = orphans.filter((o) => selected.has(o.path)).reduce((s, o) => s + o.size, 0)

  const sudoValue = data?.isRoot
    ? 'root'
    : sudoStatus?.method === 'vault'
      ? `cofre (${sudoStatus.configuredUser})`
      : data?.canSudo
        ? 'sem senha'
        : 'requer senha'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Total liberável"
          value={loading ? '—' : formatBytes(total)}
          hint="soma das tarefas abaixo"
          icon={<Sparkles className="size-4 text-emerald-400" />}
        />
        <StatCard
          label="Permissão sudo"
          value={sudoValue}
          hint={data?.canSudo || data?.isRoot ? 'tarefas sudo executáveis daqui' : 'clique em Configurar Sudo abaixo'}
          icon={<ShieldAlert className={cn('size-4', data?.canSudo || data?.isRoot ? 'text-emerald-400' : 'text-amber-400')} />}
        />
        <StatCard
          label="Swapfiles órfãos"
          value={loading ? '—' : String(orphans.length)}
          hint={orphans.length ? formatBytes(selectedFreed) + ' selecionados' : 'nenhum detectado'}
          icon={<Trash2 className="size-4 text-rose-400" />}
        />
      </div>

      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-sm',
          data?.canSudo || data?.isRoot
            ? 'border-emerald-500/25 bg-emerald-500/5'
            : 'border-amber-400/30 bg-amber-400/5',
        )}
      >
        <div className="flex items-start gap-2.5">
          {data?.canSudo || data?.isRoot ? (
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          ) : (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
          )}
          <p className="text-muted-foreground">
            {data?.canSudo || data?.isRoot ? (
              <>
                Elevação <b className="text-foreground">sudo</b> ativa ({sudoValue}). Todas as tarefas de limpeza podem ser
                executadas diretamente pelo navegador.
              </>
            ) : (
              <>
                Você não tem sudo configurado. Configure a credencial no <b className="text-foreground">Cofre Sudo</b> para
                liberar os botões <b className="text-foreground">Limpar</b> ou copie o comando para o terminal.
              </>
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant={data?.canSudo || data?.isRoot ? 'outline' : 'default'}
          className="shrink-0"
          onClick={() => setSudoOpen(true)}
        >
          <KeyRound className="size-3.5" />
          {data?.canSudo || data?.isRoot ? 'Credencial Sudo' : 'Configurar Sudo'}
        </Button>
      </div>

      {orphans.length > 0 && (
        <Card className="border-rose-400/30 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Trash2 className="size-4 text-rose-400" />
              <h3 className="text-sm font-semibold">Swapfiles órfãos detectados</h3>
            </div>
            <Button
              variant="destructive"
              size="sm"
              disabled={running || selected.size === 0}
              onClick={() => swapTask && setConfirm(swapTask)}
            >
              Remover selecionados ({selected.size})
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Arquivos de swap na raiz que <b>não</b> estão ativos nem constam no /etc/fstab. Não estão em uso pelo sistema.
          </p>
          <Separator className="my-3" />
          <div className="space-y-1">
            {orphans.map((o) => (
              <label key={o.path} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
                <Checkbox
                  checked={selected.has(o.path)}
                  onCheckedChange={(c) =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (c) next.add(o.path)
                      else next.delete(o.path)
                      return next
                    })
                  }
                />
                <span className="font-mono text-xs">{o.path}</span>
                <span className="ml-auto text-xs font-semibold tabular-nums">{formatBytes(o.size)}</span>
              </label>
            ))}
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Tarefas de limpeza</h3>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn(loading && 'animate-spin')} />
          Recalcular
        </Button>
      </div>

      {loading && !data ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {(data?.tasks ?? []).map((t) => {
            const sudoBlocked = t.sudo && !data?.canSudo && !data?.isRoot
            const disabled = running || (t.special === 'swap' ? selected.size === 0 : false)
            const cmdDisplay = t.command || FALLBACK_CMD[t.id] || ''
            return (
              <Card key={t.id} className="gap-2.5 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.title}</span>
                      <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', RISK[t.risk].className)}>
                        {RISK[t.risk].label}
                      </Badge>
                      {t.sudo && (
                        <Badge variant={sudoBlocked ? 'destructive' : 'secondary'} className="h-5 px-1.5 text-[10px]">
                          sudo{sudoBlocked ? ' · requer senha' : ''}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{t.desc}</p>
                  </div>
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                    {formatBytes(t.size)}
                  </span>
                </div>

                <div className="flex items-center gap-2.5">
                  {cmdDisplay && <CopyCommand command={cmdDisplay} />}
                  <Button
                    variant={t.risk === 'high' ? 'destructive' : 'secondary'}
                    size="sm"
                    className="ml-auto shrink-0"
                    disabled={disabled || sudoBlocked}
                    title={sudoBlocked ? 'Configure o Cofre Sudo acima ou use o comando no terminal' : undefined}
                    onClick={() => setConfirm(t)}
                  >
                    {running && confirm?.id === t.id ? <Loader2 className="animate-spin" /> : <Eraser />}
                    Limpar
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {last && (
        <Card className="p-4">
          <div className="flex items-center gap-2">
            {last.needsPassword || last.ok === false ? (
              <TriangleAlert className="size-4 text-amber-400" />
            ) : (
              <Check className="size-4 text-emerald-400" />
            )}
            <span className="text-sm font-semibold">Último resultado</span>
            <Badge variant="secondary" className="ml-auto">
              liberado {formatBytes(last.freed)}
            </Badge>
          </div>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
            {last.needsPassword
              ? `Precisa de senha. Configure o Cofre Sudo ou rode:\n\n  ${last.command}`
              : [last.stdout, last.stderr].filter(Boolean).join('\n') || last.error || 'Sem saída.'}
            {last.results?.length
              ? last.results.map((r) => `\n${r.ok ? 'ok' : 'falhou'}  ${r.target}${r.error ? ' — ' + r.error : ''}`).join('')
              : ''}
          </pre>
        </Card>
      )}

      <SudoConfigModal
        open={sudoOpen}
        onOpenChange={setSudoOpen}
        defaultUser={sudoStatus?.configuredUser || 'raony'}
        humanUsers={sudoStatus?.humanUsers || []}
        hasSavedPassword={!!sudoStatus?.hasSavedPassword}
        onSaved={() => {
          load()
        }}
      />

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-destructive" />
              Confirmar: {confirm?.title}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.special === 'swap'
                ? `Serão removidos ${selected.size} arquivo(s) de swap (${formatBytes(selectedFreed)}).`
                : `Esta ação remove ${formatBytes(confirm?.size ?? 0)} de dados.`}{' '}
              {confirm?.risk === 'high' && <b className="text-foreground">É irreversível — revise antes de continuar.</b>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm?.command && <CopyCommand command={confirm.command} />}
          {confirm?.special === 'swap' && (
            <ul className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-[11px]">
              {[...selected].map((p) => (
                <li key={p} className="truncate">
                  {p}
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={running}
              onClick={(e) => {
                e.preventDefault()
                if (confirm) run(confirm)
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {running ? <Loader2 className="animate-spin" /> : <Eraser />}
              Confirmar limpeza
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
