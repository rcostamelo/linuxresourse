import { useCallback, useEffect, useState } from 'react'
import {
  Boxes,
  Check,
  CircleCheckIcon,
  KeyRound,
  Layers,
  Link2,
  Loader2,
  Package,
  RefreshCw,
  ScrollText,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
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
import type { SystemAboutOverview, SystemReleaseItem } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

function formatReleaseDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function installModeLabel(mode: string): string {
  switch (mode) {
    case 'deb':
      return 'Pacote Debian (.deb + systemd)'
    case 'docker-git':
      return 'Docker Compose + Repositório Git'
    case 'git':
      return 'Repositório Git Local'
    default:
      return 'Standalone'
  }
}

/**
 * Renderiza texto inline com suporte a **negrito**, `código` e [links](url).
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  const parts = text.split(tokenRegex)

  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-foreground">
          {renderInlineMarkdown(part.slice(2, -2))}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="rounded border border-cyan-500/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-cyan-300"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      return (
        <a
          key={idx}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-cyan-400 underline underline-offset-2 hover:text-cyan-300"
        >
          {linkMatch[1]}
        </a>
      )
    }
    return <span key={idx}>{part}</span>
  })
}

/**
 * Renderiza Markdown de Release Notes (títulos, listas, blocos de código e parágrafos).
 */
function ReleaseMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const elements: React.ReactNode[] = []
  let listItems: string[] = []
  let codeBlock: string[] | null = null

  const flushList = (keyPrefix: string) => {
    if (listItems.length === 0) return
    elements.push(
      <ul key={`${keyPrefix}-ul`} className="my-2 space-y-1.5 pl-1">
        {listItems.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-foreground/90">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-cyan-400" />
            <span className="min-w-0 flex-1">{renderInlineMarkdown(item)}</span>
          </li>
        ))}
      </ul>,
    )
    listItems = []
  }

  lines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim()

    if (trimmed.startsWith('```')) {
      flushList(`l-${idx}`)
      if (codeBlock === null) {
        codeBlock = []
      } else {
        elements.push(
          <pre
            key={`code-${idx}`}
            className="my-2 overflow-x-auto rounded-lg border border-border bg-black/80 p-2.5 font-mono text-[11px] text-zinc-200"
          >
            <code>{codeBlock.join('\n')}</code>
          </pre>,
        )
        codeBlock = null
      }
      return
    }

    if (codeBlock !== null) {
      codeBlock.push(rawLine)
      return
    }

    if (!trimmed) {
      flushList(`empty-${idx}`)
      return
    }

    if (trimmed.startsWith('### ')) {
      flushList(`h3-${idx}`)
      elements.push(
        <h4
          key={`h3-${idx}`}
          className="mt-2 first:mt-0 mb-1.5 flex items-center gap-1.5 font-mono text-xs font-bold tracking-wide text-cyan-300 uppercase"
        >
          <Sparkles className="size-3 text-cyan-400" />
          {renderInlineMarkdown(trimmed.slice(4))}
        </h4>,
      )
      return
    }

    if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
      flushList(`h2-${idx}`)
      const titleText = trimmed.replace(/^#+\s+/, '')
      elements.push(
        <h3
          key={`h2-${idx}`}
          className="mt-2 first:mt-0 mb-1.5 font-mono text-sm font-bold text-foreground"
        >
          {renderInlineMarkdown(titleText)}
        </h3>,
      )
      return
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      listItems.push(trimmed.slice(2).trim())
      return
    }

    flushList(`p-${idx}`)
    elements.push(
      <p key={`p-${idx}`} className="my-1.5 text-xs leading-relaxed text-foreground/90">
        {renderInlineMarkdown(trimmed)}
      </p>,
    )
  })

  flushList('end')

  return <div className="space-y-1">{elements}</div>
}

export function SystemUpdatePanel() {
  const [overview, setOverview] = useState<SystemAboutOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [applyingTag, setApplyingTag] = useState<string | null>(null)

  // Modal Cofre Sudo
  const [sudoOpen, setSudoOpen] = useState(false)
  const [sudoUser, setSudoUser] = useState('')
  const [sudoPass, setSudoPass] = useState('')
  const [savingSudo, setSavingSudo] = useState(false)

  const loadOverview = useCallback(async (force = false, silent = false) => {
    if (!silent) setLoading(true)
    if (force) setChecking(true)
    try {
      const data = await api.systemUpdateOverview(force)
      setOverview(data)
      if (!sudoUser && data.sudo?.configuredUser) {
        setSudoUser(data.sudo.configuredUser)
      }
      if (force) {
        if (data.updateAvailable) {
          toast.info(`Nova versão v${data.latestVersion} disponível!`)
        } else {
          toast.success(`Você já está na versão mais recente (v${data.currentVersion}).`)
        }
      }
    } catch (e: unknown) {
      if (!silent) {
        toast.error(e instanceof Error ? e.message : 'Erro ao consultar atualizações')
      }
    } finally {
      if (!silent) setLoading(false)
      if (force) setChecking(false)
    }
  }, [sudoUser])

  useEffect(() => {
    loadOverview(false, false)
  }, [loadOverview])

  // Se houver um job de atualização rodando, faz polling rápido para atualizar logs e recarregar quando terminar
  useEffect(() => {
    if (!overview?.updateJob?.running) return
    const id = setInterval(async () => {
      try {
        const next = await api.systemUpdateOverview(false)
        setOverview(next)
        if (!next.updateJob.running && next.updateJob.status === 'success') {
          toast.success('Atualização concluída! Recarregando painel…')
          setTimeout(() => window.location.reload(), 1800)
        }
      } catch {
        setTimeout(() => window.location.reload(), 2500)
      }
    }, 2000)
    return () => clearInterval(id)
  }, [overview?.updateJob?.running])

  const handleApplyUpdate = async (tagName?: string) => {
    setApplyingTag(tagName || 'latest')
    try {
      const res = await api.systemUpdateApply(tagName)
      setOverview((prev) => (prev ? { ...prev, updateJob: res.updateJob } : prev))
      toast.info('Atualização iniciada em segundo plano. Acompanhe o progresso abaixo.')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Falha ao iniciar atualização')
    } finally {
      setApplyingTag(null)
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
      await loadOverview(false, true)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erro ao validar sudo')
    } finally {
      setSavingSudo(false)
    }
  }

  if (loading && !overview) {
    return (
      <TelemetryLoader
        variant="docker"
        labelOverride="Verificando versão do sistema e histórico de releases no GitHub…"
      />
    )
  }

  const env = overview?.environment
  const job = overview?.updateJob

  return (
    <div className="space-y-4">
      {/* KPIs Sobre o Sistema */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Versão Instalada"
          value={`v${overview?.currentVersion ?? '—'}`}
          hint={
            overview?.updateAvailable
              ? `Nova release disponível: v${overview.latestVersion}`
              : 'Sistema na última versão oficial'
          }
          icon={<Sparkles className="size-4 text-cyan-400" />}
        />
        <StatCard
          label="Modo de Instalação"
          value={env?.installMode === 'deb' ? 'Pacote .deb' : env?.installMode === 'docker-git' ? 'Docker + Git' : 'Git Local'}
          hint={installModeLabel(env?.installMode || '')}
          icon={<Package className="size-4 text-emerald-400" />}
        />
        <StatCard
          label="Ambiente Desktop & Widgets"
          value={env?.desktopEnv || 'Linux'}
          hint={
            env?.kdeWidgetInstalled
              ? 'Plasmoid KDE + Janela Nativa ativos'
              : env?.gnomeWidgetInstalled
                ? 'Extensão GNOME + Janela Nativa ativos'
                : 'Modo Servidor / Web Console'
          }
          icon={<Layers className="size-4 text-violet-400" />}
        />
        <StatCard
          label="Runtime & Host"
          value={`Node ${env?.nodeVersion || ''}`}
          hint={`${env?.hostname || ''} · ${env?.platform || ''}`}
          icon={<Server className="size-4 text-amber-400" />}
        />
      </div>

      {/* Card Principal: Sobre o Sistema & Central de Atualização */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-cyan-400" />
                Sobre o Linux Resource & Atualizações Automáticas
                {overview?.updateAvailable ? (
                  <Badge className="border-amber-400/40 bg-amber-500/15 font-mono text-[10px] text-amber-300">
                    NOVA VERSÃO v{overview.latestVersion} DISPONÍVEL
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/35 bg-emerald-500/10 font-mono text-[10px] text-emerald-300"
                  >
                    <CircleCheckIcon className="mr-1 size-3" />
                    ATUALIZADO (v{overview?.currentVersion})
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Gerencie atualizações automáticas via pacote Debian (`.deb`) ou Git/Docker e consulte as notas de lançamento oficiais.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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

              <Button
                size="sm"
                variant="outline"
                disabled={checking || Boolean(job?.running)}
                onClick={() => loadOverview(true, false)}
              >
                {checking ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Verificar Atualizações
              </Button>

              <Button
                size="sm"
                disabled={Boolean(job?.running) || applyingTag !== null}
                onClick={() => handleApplyUpdate(overview?.latestRelease?.tagName)}
                className={cn(
                  overview?.updateAvailable
                    ? 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                    : '',
                )}
              >
                {job?.running || applyingTag ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                {overview?.updateAvailable
                  ? `Atualizar para v${overview.latestVersion}`
                  : `Reinstalar / Sincronizar v${overview?.currentVersion}`}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3 border-t border-border/60 pt-3">
          {/* Resumo Técnico da Instalação */}
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-background/50 p-3">
              <div className="font-mono text-[10px] text-muted-foreground uppercase">
                Método de Atualização
              </div>
              <div className="mt-1 font-mono text-xs font-semibold text-foreground">
                {installModeLabel(env?.installMode || '')}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {env?.gitRepoDir || '/opt/linux-resource'}
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-background/50 p-3">
              <div className="font-mono text-[10px] text-muted-foreground uppercase">
                Janela Dedicada Linux
              </div>
              <div className="mt-1 font-mono text-xs font-semibold text-cyan-300">
                {env?.desktopLauncherInstalled ? 'Instalada (GTK4 / WebKitGTK)' : 'Disponível no .deb'}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                Comando: linux-resource app
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-background/50 p-3">
              <div className="font-mono text-[10px] text-muted-foreground uppercase">
                Widgets de Barra (GNOME / KDE)
              </div>
              <div className="mt-1 font-mono text-xs font-semibold text-emerald-300">
                {env?.kdeWidgetInstalled
                  ? 'KDE Plasma 6 Ativo'
                  : env?.gnomeWidgetInstalled
                    ? 'GNOME Shell Ativo'
                    : 'Auto-detecção pronta'}
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                Comando: linux-resource widget
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-background/50 p-3">
              <div className="font-mono text-[10px] text-muted-foreground uppercase">
                Repositório Oficial
              </div>
              <a
                href={overview?.repoUrl || 'https://github.com/rcostamelo/linuxresourse'}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 font-mono text-xs font-semibold text-cyan-300 hover:underline"
              >
                rcostamelo/linuxresourse
                <Link2 className="size-3" />
              </a>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                Licença MIT · Linux Telemetry
              </div>
            </div>
          </div>

          {/* Progresso / Logs da Atualização em Tempo Real */}
          {job && (job.running || job.logs.length > 0) && (
            <div
              className={cn(
                'rounded-xl border p-3.5',
                job.status === 'error'
                  ? 'border-rose-500/40 bg-rose-950/20'
                  : job.status === 'success'
                    ? 'border-emerald-500/40 bg-emerald-950/20'
                    : 'border-cyan-500/40 bg-cyan-950/20',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                  {job.running ? (
                    <Loader2 className="size-4 animate-spin text-cyan-400" />
                  ) : job.status === 'success' ? (
                    <Check className="size-4 text-emerald-400" />
                  ) : (
                    <Terminal className="size-4 text-rose-400" />
                  )}
                  <span>{job.step}</span>
                </div>
                <Badge variant="outline" className="font-mono text-[10px] uppercase">
                  {job.status} · v{job.targetVersion}
                </Badge>
              </div>

              {job.logs.length > 0 && (
                <div className="mt-2.5 max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-black/80 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-200">
                  {job.logs.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap break-all">
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Histórico Completo de Releases (Changelog) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4 text-cyan-400" />
            Notas de Lançamento (Releases & Changelog)
          </CardTitle>
          <CardDescription>
            Histórico de todas as versões publicadas no GitHub com descrição das funcionalidades e pacotes `.deb`.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-3">
          {(overview?.releases ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
              {overview?.releasesError
                ? `Não foi possível consultar o GitHub no momento: ${overview.releasesError}`
                : 'Nenhuma release encontrada.'}
            </div>
          ) : (
            overview?.releases.map((rel: SystemReleaseItem, idx: number) => {
              const isCurrent = rel.version === overview.currentVersion
              const isLatest = idx === 0

              return (
                <div
                  key={rel.id || rel.tagName}
                  className={cn(
                    'rounded-xl border p-4 transition-colors',
                    isCurrent
                      ? 'border-cyan-500/40 bg-cyan-500/5'
                      : 'border-border/80 bg-card/60',
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-bold text-foreground">
                          {rel.name || rel.tagName}
                        </span>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {rel.tagName}
                        </Badge>
                        {isLatest && (
                          <Badge className="border-emerald-400/40 bg-emerald-500/15 font-mono text-[10px] text-emerald-300">
                            LATEST RELEASE
                          </Badge>
                        )}
                        {isCurrent && (
                          <Badge className="border-cyan-400/40 bg-cyan-500/15 font-mono text-[10px] text-cyan-200">
                            INSTALADA NESTE HOST
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                        Publicado em {formatReleaseDate(rel.publishedAt)}
                        {rel.debAsset && (
                          <>
                            {' · '}
                            <span className="text-cyan-300/90">
                              {rel.debAsset.name} ({formatBytes(rel.debAsset.size, 1)})
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {rel.debAsset && (
                        <a
                          href={rel.debAsset.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs text-foreground hover:border-cyan-400/40 hover:text-cyan-200"
                        >
                          <Boxes className="size-3 text-cyan-400" />
                          Baixar .deb
                        </a>
                      )}

                      {!isCurrent && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={Boolean(job?.running) || applyingTag !== null}
                          onClick={() => handleApplyUpdate(rel.tagName)}
                          className="border-cyan-500/35 text-cyan-300"
                        >
                          {applyingTag === rel.tagName ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Zap className="size-3" />
                          )}
                          Instalar {rel.tagName}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Corpo do Release renderizado como Markdown */}
                  <div className="mt-3 rounded-lg border border-border/60 bg-background/55 p-3.5">
                    {rel.body ? (
                      <ReleaseMarkdown content={rel.body} />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Pacote Debian (.deb) e código-fonte desta versão.
                      </p>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* Modal: Cofre Sudo */}
      <AlertDialog open={sudoOpen} onOpenChange={setSudoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-cyan-400" /> Cofre de Elevação Sudo (Atualização do Sistema)
            </AlertDialogTitle>
            <AlertDialogDescription>
              Para instalar novos pacotes `.deb` ou reconstruir o serviço automaticamente no host, informe a credencial sudo.
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
