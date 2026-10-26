import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Sparkles } from '@/components/ui/lucide-animated'
import { cn } from '@/lib/utils'

export type ThemeId = 'default' | 'retro-bw' | 'light-bw' | 'monokai'

export interface ThemeMeta {
  id: ThemeId
  label: string
  shortLabel: string
  subtitle: string
  isDark: boolean
  themeColor: string
  swatches: [string, string, string]
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'default',
    label: 'Mission Control (Padrão)',
    shortLabel: 'Padrão',
    subtitle: 'Cyber-telemetria escuro · Ciano & Violeta',
    isDark: true,
    themeColor: '#09090b',
    swatches: ['#090d16', '#22d3ee', '#10b981'],
  },
  {
    id: 'retro-bw',
    label: 'Retrô P&B (Terminal)',
    shortLabel: 'Retrô P&B',
    subtitle: 'Preto e branco puro · Interfaces antigas',
    isDark: true,
    themeColor: '#000000',
    swatches: ['#000000', '#ffffff', '#737373'],
  },
  {
    id: 'light-bw',
    label: 'Claro P&B (Papel & Tinta)',
    shortLabel: 'Claro P&B',
    subtitle: 'Branco e preto de alto contraste',
    isDark: false,
    themeColor: '#ffffff',
    swatches: ['#ffffff', '#09090b', '#a1a1aa'],
  },
  {
    id: 'monokai',
    label: 'Monokai Classic',
    shortLabel: 'Monokai',
    subtitle: 'Carvão quente · Verde, Rosa & Amarelo',
    isDark: true,
    themeColor: '#272822',
    swatches: ['#272822', '#a6e22e', '#f92672'],
  },
]

const STORAGE_KEY = 'lr:theme:v1'

interface ThemeContextValue {
  theme: ThemeId
  themeMeta: ThemeMeta
  setTheme: (id: ThemeId) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'default',
  themeMeta: THEMES[0],
  setTheme: () => {},
})

function applyDomTheme(meta: ThemeMeta) {
  const root = document.documentElement
  root.setAttribute('data-theme', meta.id)
  if (meta.isDark) {
    root.classList.add('dark')
    root.classList.remove('light')
  } else {
    root.classList.remove('dark')
    root.classList.add('light')
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]')
  if (metaTheme) metaTheme.setAttribute('content', meta.themeColor)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null
      if (saved && THEMES.some((t) => t.id === saved)) return saved
    } catch {
      /* ignore */
    }
    return 'default'
  })

  const themeMeta = THEMES.find((t) => t.id === theme) ?? THEMES[0]

  useEffect(() => {
    applyDomTheme(themeMeta)
    try {
      localStorage.setItem(STORAGE_KEY, themeMeta.id)
    } catch {
      /* ignore */
    }
  }, [themeMeta])

  return (
    <ThemeContext.Provider value={{ theme, themeMeta, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeSwitcher() {
  const { theme, themeMeta, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Tema atual: ${themeMeta.label}`}
        className={cn(
          'flex items-center gap-1.5 rounded-lg border bg-card/75 px-2.5 py-1.5 font-mono text-xs backdrop-blur-md transition-colors',
          open
            ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200'
            : 'border-cyan-500/15 text-foreground hover:border-cyan-400/30 hover:bg-card',
        )}
      >
        <span className="flex items-center -space-x-1">
          {themeMeta.swatches.map((hex, i) => (
            <span
              key={i}
              className="size-3 rounded-full ring-1 ring-foreground/25"
              style={{ backgroundColor: hex }}
            />
          ))}
        </span>
        <span className="hidden font-medium sm:inline">{themeMeta.shortLabel}</span>
        <ChevronDown
          className={cn(
            'size-3.5 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180 text-cyan-300',
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-cyan-500/30 bg-popover p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.8)]">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            <Sparkles className="size-3 text-cyan-400" /> Tema da Interface
          </div>
          <div className="mt-1 space-y-0.5">
            {THEMES.map((item) => {
              const active = item.id === theme
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTheme(item.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    active
                      ? 'bg-cyan-500/15 text-foreground ring-1 ring-cyan-400/30'
                      : 'text-foreground/90 hover:bg-muted/80',
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex shrink-0 items-center -space-x-1 rounded-md border border-border bg-background p-1">
                      {item.swatches.map((hex, i) => (
                        <span
                          key={i}
                          className="size-3 rounded-full ring-1 ring-foreground/20"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-semibold leading-tight">
                        {item.label}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                  {active && <Check className="size-3.5 shrink-0 text-cyan-400" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
