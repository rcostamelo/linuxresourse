import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Cable, Globe, Plug, Radio, Search, Timer, Waypoints } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { AreaSeries } from '@/components/charts'
import { StatCard } from '@/components/StatCard'
import { api } from '@/lib/api'
import type { Connection } from '@/lib/api'
import { usePoll } from '@/lib/usePoll'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

const C = { rx: '#38bdf8', tx: '#e879f9' }
const formatRate = (bps: number) => `${formatBytes(bps, 1)}/s`
const isVirtual = (name: string) => /^(veth|br-|docker|virbr|lo$|tun|tap)/.test(name)

export function RedePanel() {
  const { data: net } = usePoll(api.network, 3000)
  const { data: history } = usePoll(api.history, 2000)
  const { data: conn } = usePoll(() => api.connections(500), 4000)
  const [showVirtual, setShowVirtual] = useState(false)
  const [connFilter, setConnFilter] = useState('ESTABLISHED')
  const [q, setQ] = useState('')

  const series = useMemo(() => {
    const p = history?.points ?? []
    return { rx: p.map((x) => x.rx), tx: p.map((x) => x.tx) }
  }, [history])

  const ifaces = useMemo(
    () => (net?.interfaces ?? []).filter((i) => showVirtual || !isVirtual(i.name)),
    [net, showVirtual],
  )

  const realIfaces = useMemo(() => (net?.interfaces ?? []).filter((i) => !i.internal && !isVirtual(i.name)), [net])
  const totalTransferred = realIfaces.reduce((acc, i) => acc + i.rxTotal + i.txTotal, 0)
  const totalErrs = realIfaces.reduce((acc, i) => acc + i.rxErrs + i.txErrs + i.rxDrop + i.txDrop, 0)

  const tcpCounts = useMemo(
    () => Object.entries(net?.tcp?.counts ?? {}).sort((a, b) => b[1] - a[1]),
    [net],
  )
  const tcpMax = Math.max(1, ...tcpCounts.map(([, v]) => v))

  const connections = useMemo(() => {
    let list = conn?.connections ?? []
    if (connFilter !== 'TODAS') list = list.filter((c) => c.state === connFilter)
    const s = q.trim().toLowerCase()
    if (s) {
      list = list.filter((c) =>
        [c.localIp, String(c.localPort), c.remoteIp, String(c.remotePort), c.state, c.proto]
          .join(' ')
          .toLowerCase()
          .includes(s),
      )
    }
    return list
  }, [conn, connFilter, q])

  const states = useMemo(() => Object.keys(conn?.counts ?? {}), [conn])

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Latência" value={net?.latency != null ? `${net.latency} ms` : '—'} hint="ping 1.1.1.1" icon={<Timer className="size-4" />} />
        <StatCard
          label="Download"
          value={formatRate(net?.rx ?? 0)}
          hint="soma de todas as interfaces"
          icon={<ArrowDown className="size-4 text-sky-400" />}
        />
        <StatCard
          label="Upload"
          value={formatRate(net?.tx ?? 0)}
          hint="soma de todas as interfaces"
          icon={<ArrowUp className="size-4 text-fuchsia-400" />}
        />
        <StatCard
          label="Conexões TCP"
          value={String(conn?.total ?? net?.tcp?.total ?? 0)}
          hint={totalErrs ? `${totalErrs} erros/drops acumulados` : `tráfego total ${formatBytes(totalTransferred, 1)}`}
          icon={<Plug className="size-4 text-emerald-400" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Waypoints className="size-4 text-fuchsia-400" /> Tráfego ao longo do tempo
          </CardTitle>
          <CardDescription>Download e upload agregados, exceto loopback</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-2 flex items-center gap-4 text-xs">
            <LegendC color={C.rx} label="Download" value={formatRate(net?.rx ?? 0)} />
            <LegendC color={C.tx} label="Upload" value={formatRate(net?.tx ?? 0)} />
          </div>
          <AreaSeries
            height={180}
            series={[
              { name: 'rx', color: C.rx, data: series.rx },
              { name: 'tx', color: C.tx, data: series.tx },
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cable className="size-4 text-amber-400" /> Interfaces
              </CardTitle>
              <Button variant="ghost" size="xs" onClick={() => setShowVirtual((v) => !v)}>
                {showVirtual ? 'ocultar virtuais' : 'mostrar virtuais'}
              </Button>
            </div>
            <CardDescription>
              {realIfaces.length} interfaces físicas · {formatBytes(totalTransferred, 1)} transferidos
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Interface</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead className="text-right">↓ agora</TableHead>
                  <TableHead className="text-right">↑ agora</TableHead>
                  <TableHead className="text-right">↓ total</TableHead>
                  <TableHead className="text-right">↑ total</TableHead>
                  <TableHead className="text-right">erros</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ifaces.map((i) => {
                  const r = net?.perIface?.[i.name]
                  const errs = i.rxErrs + i.txErrs + i.rxDrop + i.txDrop
                  return (
                    <TableRow key={i.name}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'size-2 rounded-full',
                              i.operstate === 'up' ? 'bg-emerald-400' : i.internal ? 'bg-muted-foreground' : 'bg-amber-400',
                            )}
                          />
                          <span className="font-mono text-xs font-semibold">{i.name}</span>
                          {i.speed && (
                            <Badge variant="outline" className="h-4 px-1 text-[9px]">
                              {i.speed >= 1000 ? `${i.speed / 1000}Gb` : `${i.speed}Mb`}
                            </Badge>
                          )}
                          {isVirtual(i.name) && (
                            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                              virtual
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{i.ipv4 || '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-sky-400">{formatRate(r?.rx ?? 0)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-fuchsia-400">{formatRate(r?.tx ?? 0)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatBytes(i.rxTotal, 1)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatBytes(i.txTotal, 1)}</TableCell>
                      <TableCell className={cn('text-right font-mono text-xs', errs > 0 ? 'text-amber-400' : 'text-muted-foreground')}>
                        {errs}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="size-4 text-sky-400" /> Estados TCP
            </CardTitle>
            <CardDescription>{net?.tcp?.total ?? 0} conexões rastreadas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {tcpCounts.map(([state, count]) => (
              <div key={state} className="grid grid-cols-[1fr_auto] items-center gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-24 truncate text-xs text-muted-foreground">{state.toLowerCase()}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-sky-400" style={{ width: `${(count / tcpMax) * 100}%` }} />
                  </div>
                </div>
                <span className="font-mono text-xs tabular-nums">{count}</span>
              </div>
            ))}
            <Separator />
            <div>
              <div className="mb-1.5 text-xs text-muted-foreground">Portas em LISTEN</div>
              <div className="flex flex-wrap gap-1">
                {(net?.tcp?.listen ?? []).map((port) => (
                  <Badge key={port} variant="outline" className="font-mono text-[10px]">
                    {port}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="size-4 text-emerald-400" /> Conexões ativas
              </CardTitle>
              <CardDescription>
                {conn?.total ?? 0} no total · exibindo {connections.length}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tabs value={connFilter} onValueChange={setConnFilter}>
                <TabsList>
                  <TabsTrigger value="ESTABLISHED">Estabelecidas</TabsTrigger>
                  <TabsTrigger value="LISTEN">Ouvindo</TabsTrigger>
                  <TabsTrigger value="TIME_WAIT">Time wait</TabsTrigger>
                  <TabsTrigger value="TODAS">Todas</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="relative">
                <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="filtrar IP/porta…"
                  className="h-8 w-44 pl-7 text-xs"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <ScrollArea className="h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Local</TableHead>
                  <TableHead>Remoto</TableHead>
                  <TableHead className="text-right">UID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {connections.map((c: Connection) => (
                  <TableRow key={`${c.proto}-${c.localIp}-${c.localPort}-${c.remoteIp}-${c.remotePort}-${c.inode}`}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {c.proto}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={cn('text-xs', stateColor(c.state))}>{c.state}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {c.localIp}:{c.localPort}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {c.state === 'LISTEN' ? '—' : `${c.remoteIp}:${c.remotePort}`}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">{c.uid}</TableCell>
                  </TableRow>
                ))}
                {connections.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhuma conexão para este filtro.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <div className="text-center text-xs text-muted-foreground">
        {states.length} estados distintos observados · dados de /proc/net/tcp e /proc/net/tcp6
      </div>
    </div>
  )
}

function LegendC({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className="size-2.5 rounded-full" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground tabular-nums">{value}</span>
    </span>
  )
}

function stateColor(state: string) {
  switch (state) {
    case 'ESTABLISHED':
      return 'text-emerald-400'
    case 'LISTEN':
      return 'text-sky-400'
    case 'TIME_WAIT':
    case 'CLOSE_WAIT':
      return 'text-amber-400'
    case 'SYN_SENT':
    case 'SYN_RECV':
      return 'text-violet-400'
    default:
      return 'text-muted-foreground'
  }
}
