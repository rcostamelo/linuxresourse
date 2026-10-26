import { useEffect, useState } from 'react'
import {
  Check,
  Loader2,
  Sparkles,
  Timer,
  Zap,
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
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { api } from '@/lib/api'
import type { AuthUser } from '@/lib/api'
import { cn } from '@/lib/utils'

export const KEEP_ALIVE_STORAGE_KEY = 'lr_keep_session_alive'

interface SessionOption {
  days: number
  label: string
  subtitle: string
  badge?: string
  color: string
}

const PRESETS: SessionOption[] = [
  {
    days: 365,
    label: 'Permanente (1 ano)',
    subtitle: 'Segurar sessão indefinidamente com renovação contínua automática.',
    badge: 'MÁXIMA COMODIDADE',
    color: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
  },
  {
    days: 30,
    label: '30 dias',
    subtitle: '1 mês conectado no navegador sem necessidade de novo login.',
    badge: 'RECOMENDADO',
    color: 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300',
  },
  {
    days: 7,
    label: '7 dias (Padrão)',
    subtitle: 'Validade de 1 semana a partir de cada renovação.',
    color: 'border-white/15 bg-card/60 text-foreground',
  },
  {
    days: 1,
    label: '1 dia (Temporário)',
    subtitle: 'Expira em 24h. Recomendado para computadores compartilhados.',
    color: 'border-white/10 bg-card/40 text-muted-foreground',
  },
]

function formatRemaining(expiresAt: number | null): string {
  if (!expiresAt) return 'Sessão temporária de navegador'
  const diff = expiresAt - Date.now()
  if (diff <= 0) return 'Expirada'
  const days = Math.floor(diff / (24 * 60 * 60 * 1000))
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  if (days >= 300) return 'Permanente (~1 ano)'
  if (days > 0) return `${days} dia${days > 1 ? 's' : ''} e ${hours}h restantes`
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000))
  return `${hours}h ${minutes}min restantes`
}

function formatExpirationDate(expiresAt: number | null): string {
  if (!expiresAt) return '—'
  try {
    return new Date(expiresAt).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

export function SessionHoldModal({
  open,
  onOpenChange,
  currentUser,
  sessionExpiresAt,
  onSessionUpdated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentUser: AuthUser
  sessionExpiresAt: number | null
  onSessionUpdated: (newExpiresAt: number) => void
}) {
  const [selectedDays, setSelectedDays] = useState<number>(30)
  const [keepAlive, setKeepAlive] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEEP_ALIVE_STORAGE_KEY) !== 'false'
    } catch {
      return true
    }
  })
  const [busy, setBusy] = useState(false)
  const [currentExpiresAt, setCurrentExpiresAt] = useState<number | null>(sessionExpiresAt)

  useEffect(() => {
    setCurrentExpiresAt(sessionExpiresAt)
  }, [sessionExpiresAt])

  async function handleApply() {
    setBusy(true)
    try {
      const res = await api.authExtendSession({ ttlDays: selectedDays })
      try {
        localStorage.setItem(KEEP_ALIVE_STORAGE_KEY, keepAlive ? 'true' : 'false')
      } catch {
        /* ignore */
      }
      setCurrentExpiresAt(res.sessionExpiresAt)
      onSessionUpdated(res.sessionExpiresAt)
      toast.success(
        selectedDays >= 365
          ? 'Sessão permanente ativada com sucesso!'
          : `Sessão estendida por ${selectedDays} dias!`,
        {
          description: `Seu acesso permanecerá conectado até ${formatExpirationDate(res.sessionExpiresAt)}.`,
        },
      )
      onOpenChange(false)
    } catch (e) {
      toast.error('Falha ao estender sessão', {
        description: String((e as Error).message || e),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <AlertDialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-500/15 text-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.2)]">
              <Timer className="size-5" />
            </div>
            <div>
              <AlertDialogTitle className="text-base font-semibold">
                Segurar Sessão & Duração de Acesso
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-muted-foreground">
                Escolha por quanto tempo você deseja permanecer conectado ao console sem ser deslogado.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          {/* Status Atual da Sessão */}
          <div className="rounded-xl border border-cyan-500/20 bg-card/60 p-3.5 backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-foreground">
                  @{currentUser.username}
                </span>
                <Badge variant="outline" className="h-4 px-1.5 font-mono text-[9px] uppercase">
                  {currentUser.role || 'admin'}
                </Badge>
                <span className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-400">
                  <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                  CONECTADO
                </span>
              </div>
              <span className="font-mono text-xs font-medium text-cyan-300">
                {formatRemaining(currentExpiresAt)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
              <span>Expira em: <b className="text-foreground">{formatExpirationDate(currentExpiresAt)}</b></span>
              <span>·</span>
              <span>Cookie seguro HttpOnly (SameSite=Lax)</span>
            </div>
          </div>

          {/* Opções de Duração */}
          <div className="space-y-2">
            <label className="block font-mono text-xs font-medium text-muted-foreground uppercase">
              Selecione o período para segurar a sessão
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              {PRESETS.map((p) => {
                const active = selectedDays === p.days
                return (
                  <button
                    key={p.days}
                    type="button"
                    onClick={() => setSelectedDays(p.days)}
                    className={cn(
                      'relative flex flex-col items-start justify-between rounded-xl border p-3 text-left transition-all',
                      active
                        ? 'border-cyan-400 bg-cyan-500/15 shadow-[0_0_20px_-4px_rgba(34,211,238,0.3)] ring-1 ring-cyan-400/50'
                        : 'border-white/10 bg-card/40 hover:border-white/20 hover:bg-card/70',
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs font-bold text-foreground">
                          {p.label}
                        </span>
                        {p.days >= 365 && <Sparkles className="size-3 text-emerald-400" />}
                      </div>
                      <div
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded-full border transition-colors',
                          active
                            ? 'border-cyan-400 bg-cyan-400 text-black'
                            : 'border-white/20 bg-black/20 text-transparent',
                        )}
                      >
                        <Check className="size-3 stroke-[3]" />
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {p.subtitle}
                    </p>
                    {p.badge && (
                      <span className="mt-2 rounded bg-cyan-500/20 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider text-cyan-300 uppercase">
                        {p.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Opção Keep-Alive Silencioso */}
          <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-card/40 p-3">
            <Checkbox
              id="keep-alive-cb"
              checked={keepAlive}
              onCheckedChange={(c) => setKeepAlive(Boolean(c))}
              className="mt-0.5 border-cyan-500/40 data-checked:bg-cyan-500 data-checked:border-cyan-400"
            />
            <label htmlFor="keep-alive-cb" className="cursor-pointer space-y-0.5 text-xs select-none">
              <span className="font-medium text-foreground">
                Renovação contínua automática (Keep-Alive em segundo plano)
              </span>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Enquanto o aplicativo ou aba estiver aberto, a sessão será prolongada silenciosamente
                para que você nunca seja desconectado no meio de uma tarefa.
              </p>
            </label>
          </div>
        </div>

        <AlertDialogFooter className="flex-row items-center justify-end gap-2">
          <AlertDialogCancel disabled={busy} className="mt-0">
            Cancelar
          </AlertDialogCancel>
          <Button
            type="button"
            onClick={handleApply}
            disabled={busy}
            className="gap-2 bg-cyan-500 font-semibold text-black hover:bg-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.3)]"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Zap className="size-4" />
            )}
            {busy ? 'Salvando…' : 'Salvar e Segurar Sessão'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
