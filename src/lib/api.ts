export interface DiskItem {
  name: string
  path: string
  isDir: boolean
  size: number
  isLink?: boolean
  denied?: boolean
}

export interface FsInfo {
  total: number
  free: number
  used: number
}

export interface DiskMount {
  device: string
  name: string
  diskName: string
  model: string
  kind: 'NVMe' | 'SSD' | 'HDD' | 'Disco' | string
  fstype: string
  mount: string
  label: string
  total: number
  used: number
  free: number
  usedPct: number
  mounted: boolean
}

export interface DiskPartition {
  name: string
  device: string
  size: number
  mounted: boolean
  mount: string | null
  label: string
  fstype: string | null
  total: number
  used: number
  free: number
  usedPct: number
}

export interface PhysicalDisk {
  name: string
  device: string
  model: string
  kind: 'NVMe' | 'SSD' | 'HDD' | 'Disco' | string
  rawSize: number
  mounted: boolean
  total: number
  used: number
  free: number
  usedPct: number
  partitions: DiskPartition[]
}

export interface DisksResponse {
  ts: number
  summary: {
    total: number
    used: number
    free: number
    usedPct: number
    mountedCount: number
    physicalCount: number
    rawPhysicalTotal: number
  }
  mounts: DiskMount[]
  physicalDisks: PhysicalDisk[]
}

export interface ProcInfo {
  pid: number
  ppid: number
  name: string
  state: string
  user: string
  cpu: number
  mem: number
  memPct: number
  threads: number
  elapsedSec: number
  cmdline: string
}

export interface ProcessesResponse {
  ts: number
  cpuUsage: number
  loadavg: [number, number, number]
  ncpu: number
  processes: ProcInfo[]
}

export interface MemoryInfo {
  total: number
  free: number
  available: number
  used: number
  buffers: number
  cached: number
  shared: number
  active: number
  inactive: number
  dirty: number
  swapTotal: number
  swapFree: number
  swapUsed: number
}

export interface GpuProcess {
  pid: number
  type?: string
  name: string
  memUsed: number
  smUtil?: number | null
  memUtil?: number | null
  encUtil?: number | null
  decUtil?: number | null
}

export interface GpuConnector {
  name: string
  status: string
  connected: boolean
  mode: string | null
}

export interface GpuDevice {
  index: number
  id: string
  name: string
  vendor: 'NVIDIA' | 'AMD' | 'Intel' | string
  driver: string | null
  vbios?: string | null
  busId: string | null
  pcieGen?: number | null
  pcieGenMax?: number | null
  pcieWidth?: number | null
  pcieWidthMax?: number | null
  utilization: number | null
  memUtilization: number | null
  encoderFps?: number | null
  memTotal: number | null
  memUsed: number | null
  memFree: number | null
  memReserved?: number | null
  memPct: number | null
  temperature: number | null
  powerDraw: number | null
  powerLimit: number | null
  powerDefaultLimit?: number | null
  powerMaxLimit?: number | null
  fanSpeed: number | null
  clockCore: number | null
  clockCoreMax?: number | null
  clockSm?: number | null
  clockMem: number | null
  clockMemMax?: number | null
  clockVideo?: number | null
  pstate: string | null
  displayActive?: boolean | null
  persistenceMode?: boolean | null
  connectors?: GpuConnector[]
  processes: GpuProcess[]
}

export interface GpuSummary {
  available: boolean
  count: number
  gpus: GpuDevice[]
  primary: GpuDevice | null
}

export interface CpuTemp {
  available: boolean
  temperature: number | null
  label: string | null
  sensor: string | null
  max: number | null
  crit: number | null
  cores: { label: string; temp: number }[]
}

export interface SystemInfo {
  hostname: string
  platform: string
  arch: string
  uptime: number
  loadavg: [number, number, number]
  ncpu: number
  cpuModel: string
  cpuUsage: number
  cpuTemp?: CpuTemp
  gpu?: GpuSummary
}

export type Risk = 'low' | 'medium' | 'high'

export interface CleanTask {
  id: string
  title: string
  desc: string
  risk: Risk
  sudo: boolean
  special: string | null
  command: string | null
  size: number
  orphans: { path: string; size: number }[] | null
}

export interface CleanTasksResponse {
  canSudo: boolean
  isRoot: boolean
  sudoUser?: string
  sudoMethod?: string
  tasks: CleanTask[]
}

export interface CleanResultItem {
  target: string
  ok: boolean
  freed: number
  error?: string | null
}

export interface CleanRunResult {
  id: string
  command: string
  freed: number
  ok?: boolean
  code?: number
  stdout?: string
  stderr?: string
  needsPassword?: boolean
  error?: string | null
  results?: CleanResultItem[]
}

export interface OsUser {
  username: string
  uid: number
  gid: number
  fullName: string
  home: string
  shell: string
  primaryGroup: string
  groups: string[]
  allGroups: string[]
  isHuman: boolean
  isSudoer: boolean
  isDocker: boolean
  homeExists: boolean
  locked: boolean
  loggedIn: boolean
}

export interface OsGroup {
  name: string
  gid: number
  count: number
}

export interface OsSudoStatus {
  canSudo: boolean
  isRoot: boolean
  method: 'root' | 'nopasswd' | 'vault' | 'none'
  configuredUser: string
  hasSavedPassword: boolean
  updatedAt: number | null
  humanUsers: { username: string; uid: number; isSudoer: boolean }[]
}

export interface OsUsersOverview {
  ts: number
  sudo: OsSudoStatus
  users: OsUser[]
  groups: OsGroup[]
  shells: string[]
}

export interface NginxUpstream {
  location: string
  target: string
  websocket: boolean
}

export type NginxScope = 'site' | 'conf.d' | 'main'

export interface NginxConfigItem {
  name: string
  scope: NginxScope
  enabled: boolean
  inAvailable: boolean
  inEnabled: boolean
  isSymlink: boolean
  symlinkTarget: string | null
  diverged: boolean
  path: string
  enabledPath: string | null
  size: number
  mtime: number
  description: string | null
  serverBlocksCount: number
  serverNames: string[]
  listenPorts: string[]
  ssl: boolean
  upstreams: NginxUpstream[]
  roots: string[]
  rateLimits: string[]
}

export interface NginxServiceInfo {
  active: boolean
  subState: string
  enabledBoot: boolean
  masterPid: number | null
  uptimeSec: number | null
  workerCount: number
  processCount: number
  memoryBytes: number
  cpuPct: number
}

export interface NginxOverview {
  ts: number
  installed: boolean
  version: string | null
  rawVersion: string | null
  service: NginxServiceInfo
  sudo: OsSudoStatus
  sites: NginxConfigItem[]
  confd: NginxConfigItem[]
  mainConfig: NginxConfigItem | null
}

export interface NginxTestResult {
  ok: boolean
  code: number
  output: string
  durationMs: number
  usedSudo: boolean
  needsSudo?: boolean
}

export interface NginxActionResult {
  ok: boolean
  action: string
  output: string
  durationMs: number
  overview?: NginxOverview
}

export interface NginxFileResponse {
  name: string
  scope: NginxScope
  path: string
  content: string
  meta: {
    description: string | null
    serverBlocksCount: number
    serverNames: string[]
    listenPorts: string[]
    ssl: boolean
    upstreams: NginxUpstream[]
    roots: string[]
    rateLimits: string[]
  }
}

export interface NginxMutationResult {
  ok: boolean
  path?: string
  name?: string
  enabled?: boolean
  testResult: NginxTestResult
  reloadResult: { ok: boolean; output: string } | null
  overview: NginxOverview
}

export interface NginxLogsResponse {
  ok: boolean
  kind: 'access' | 'error' | 'journal' | string
  source: string
  error?: string
  lines: string[]
}

export type ProcManagerEngine = 'procman' | 'pm2'

export interface ProcManagerUserRuntime {
  username: string
  uid: number
  home: string
  hasNode: boolean
  nodeBin: string | null
  procmanBin: string | null
  pm2Bin: string | null
}

export interface ProcManagerDaemon {
  engine: ProcManagerEngine
  owner: string
  ownerUid: number
  stateDir: string
  running: boolean
  pid: number | null
  version: string | null
  onlineCount: number
  totalCount: number
  savedCount: number
  binPath: string | null
}

export interface ProcManagedProcess {
  uidKey: string
  engine: ProcManagerEngine
  owner: string
  ownerUid: number
  id: number
  name: string
  namespace: string
  mode: 'fork' | 'cluster' | string
  instances: number
  pids: number[]
  pid: number | string
  ports: (number | string)[]
  status: 'online' | 'stopped' | 'errored' | 'launching' | 'saved' | string
  restarts: number
  unstableRestarts: number
  exitCode: number | null
  uptimeMs: number
  cpu: number
  memory: number
  maxMemoryRestart: number | string | null
  watch: boolean
  cron: string | null
  autorestart: boolean
  script: string
  cwd: string
  args: string[]
  outLog: string
  errLog: string
  nodeVersion?: string | null
  savedOnly: boolean
}

export interface ProcManagersOverview {
  ts: number
  runtimes: {
    procmanInstalled: boolean
    procmanBin: string | null
    pm2Installed: boolean
    pm2Bin: string | null
    nodeBin: string | null
    users: ProcManagerUserRuntime[]
  }
  sudo: OsSudoStatus
  daemons: ProcManagerDaemon[]
  processes: ProcManagedProcess[]
}

export interface ProcManagerMutationResult {
  ok: boolean
  output: string
  overview: ProcManagersOverview
}

export interface ProcManagerLogsResponse {
  engine: ProcManagerEngine
  owner: string
  outLog: string
  errLog: string
  outLines: string[]
  errLines: string[]
}

export interface NetIface {
  name: string
  mac: string | null
  ipv4: string | null
  cidr: string | null
  ipv6: string | null
  internal: boolean
  speed: number | null
  operstate: string | null
  rxTotal: number
  txTotal: number
  rxErrs: number
  txErrs: number
  rxDrop: number
  txDrop: number
}

export interface IfaceRate {
  rx: number
  tx: number
  rxTotal: number
  txTotal: number
  rxErrs: number
  txErrs: number
}

export interface TcpStates {
  counts: Record<string, number>
  listen: number[]
  total: number
}

export interface NetworkResponse {
  rx: number
  tx: number
  ts: number
  perIface: Record<string, IfaceRate>
  interfaces: NetIface[]
  tcp: TcpStates
  latency: number | null
}

export interface MetricsResponse {
  ts: number
  system: SystemInfo
  memory: MemoryInfo
  gpu?: GpuSummary
  network: { rx: number; tx: number; ts: number; perIface: Record<string, IfaceRate>; interfaces: NetIface[] }
}

export interface HistoryPoint {
  t: number
  cpu: number
  mem: number
  memUsed: number
  rx: number
  tx: number
  load: number
  cpuTemp?: number | null
  gpu?: number | null
  gpuMem?: number | null
  gpuTemp?: number | null
  gpuPower?: number | null
}

export interface HistoryResponse {
  ts: number
  points: HistoryPoint[]
}

export interface Connection {
  proto: string
  state: string
  localIp: string
  localPort: number
  remoteIp: string
  remotePort: number
  uid: number
  inode: string
}

export interface ConnectionsResponse {
  total: number
  counts: Record<string, number>
  connections: Connection[]
  latency: number | null
}

export interface ContainerStats {
  cpu: number
  memPct: number
  memUsage: string | null
  netIO: string | null
  blockIO: string | null
  pids: number
}

export interface Container {
  id: string
  name: string
  image: string
  command: string
  state: string
  status: string
  ports: string
  createdAt: string
  runningFor: string
  size: string | null
  networks: string | null
  mounts: string | null
  project: string | null
  service: string | null
  stats: ContainerStats | null
}

export interface DockerImage {
  id: string
  repository: string
  tag: string
  size: string
  createdSince: string
  containers: number
  dangling: boolean
}

export interface DockerDfRow {
  Type: string
  TotalCount: string
  Active: string
  Size: string
  Reclaimable: string
}

export interface DockerOverview {
  ts: number
  available: boolean
  error: string | null
  version?: string | null
  counts: Record<string, number>
  containers: Container[]
  images: DockerImage[]
  df: DockerDfRow[]
}

export interface DockerLogs {
  ok: boolean
  error: string | null
  logs: string
  warnings?: string
}

export interface DockerActionResponse {
  ok: boolean
  action: string
  id: string
  error: string | null
  output: string | null
}

export interface DockerInspect {
  ok: boolean
  error?: string
  data?: {
    id: string
    name: string
    created: string
    restartCount: number
    startedAt: string | null
    finishedAt: string | null
    health: string | null
    env: string[]
    cmd: string[] | string | null
    entrypoint: string[] | string | null
    workdir: string
    ports: Record<string, { HostIp: string; HostPort: string }[] | null> | null
    networks: string[]
    mounts: { source: string; dest: string; mode: string }[]
    restartPolicy: string
    memoryLimit: number
    cpuShares: number
  }
}

export type SshAuthType = 'key' | 'password' | 'system'

export type SshErrorKind =
  | 'dns'
  | 'refused'
  | 'timeout'
  | 'unreachable'
  | 'host_key'
  | 'auth'
  | 'key_file'
  | 'binary'
  | 'unknown'

export interface SshHostKey {
  known: boolean
  keyType: string | null
  fingerprint: string | null
}

export interface SshRunbook {
  id: string
  title: string
  desc: string
  category: string
  risk: Risk
  commandPreview: string
}

export interface SshRunbookResult {
  ok: boolean
  code: number
  stdout: string
  stderr: string
  durationMs: number
  error: string | null
  errorKind: SshErrorKind | null
  errorHint: string | null
  runbook: {
    id: string
    title: string
    commandPreview: string
  }
}

export interface SshAuditItem {
  id: number
  ts: number
  userId: number | null
  username: string
  serverId: number | null
  serverName: string | null
  action: string
  detail: string | null
  status: 'ok' | 'error'
  durationMs: number | null
  outputPreview: string | null
}

export interface SshDisk {
  fs: string
  fstype?: string | null
  mount: string
  total: number
  used: number
  avail: number
  usedPct: number
}

export interface SshIface {
  name: string
  ipv4?: string | null
  rx: number
  tx: number
  rxRate: number
  txRate: number
  rxErrs?: number
  txErrs?: number
  virtual: boolean
}

export interface SshProcess {
  pid: number
  user: string
  cpu: number
  memPct: number
  mem: number
  name: string
}

export interface SshHistoryPoint {
  ts: number
  cpu: number
  memPct: number
  diskPct: number
  rxRate: number
  txRate: number
  load1: number
}

export interface SshMemory {
  total: number
  used: number
  free: number
  available: number
  buffers: number
  cached: number
  swapTotal: number
  swapUsed: number
  memPct: number
}

export interface SshSnapshot {
  id: number
  online: boolean
  ts: number
  error: string | null
  errorKind?: SshErrorKind | null
  errorHint?: string | null
  failCount?: number
  backoffUntil?: number | null
  hostKey?: SshHostKey | null
  lastSeen: number | null
  uname?: string | null
  osName?: string | null
  hostname?: string | null
  cpuModel?: string | null
  ncpu?: number | null
  uptime?: number | null
  loadavg?: [number, number, number] | null
  cpuUsage?: number | null
  memory?: SshMemory | null
  disks?: SshDisk[]
  primaryDisk?: SshDisk | null
  network?: { rxRate: number; txRate: number; rxTotal: number; txTotal: number; interfaces: SshIface[] } | null
  processes?: SshProcess[]
  collectMs?: number | null
}

export interface SshServer {
  id: number
  clusterId: number | null
  name: string
  host: string
  port: number
  username: string
  authType: SshAuthType
  hasSecret: boolean
  logo: string | null
  createdAt: number
  updatedAt: number
  metrics: SshSnapshot | null
  history?: SshHistoryPoint[]
  audit?: SshAuditItem[]
}

export interface SshCluster {
  id: number | null
  name: string
  logo: string | null
  servers: SshServer[]
}

export interface SshOverview {
  ts: number
  clusters: SshCluster[]
}

export interface SshServerInput {
  name: string
  host: string
  port: number
  username: string
  authType: SshAuthType
  secret?: string
  clusterId?: number | null
  logo?: string | null
}

export const sshLogoUrl = (name: string | null | undefined): string | null =>
  name ? `/api/ssh/logo/${name}` : null

export interface SshTestResult {
  ok: boolean
  online: boolean
  error?: string | null
  errorKind?: SshErrorKind | null
  errorHint?: string | null
  hostKey?: SshHostKey | null
  hostname?: string | null
  uname?: string | null
  latencyMs?: number | null
}

export interface SshConfigHost {
  alias: string
  hostName: string | null
  user: string | null
  port: number | null
  identityFile: string | null
  proxyJump: string | null
}

export interface SshConfigResponse {
  file: string
  exists: boolean
  hosts: SshConfigHost[]
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export const UNAUTHORIZED_EVENT = 'lr:unauthorized'

async function parseError(r: Response) {
  let message = `${r.status} ${r.statusText}`
  try {
    const body = await r.json()
    if (body?.error) message = body.error
  } catch {
    /* sem corpo JSON */
  }
  if (r.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
  return new ApiError(r.status, message)
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' })
  if (!r.ok) throw await parseError(r)
  return (await r.json()) as T
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!r.ok) throw await parseError(r)
  return (await r.json()) as T
}

export type PanelRole = 'admin' | 'viewer'

export interface AuthUser {
  id: number
  username: string
  role: PanelRole
  createdAt: number
  lastLoginAt: number | null
}

export interface PanelUser extends AuthUser {
  activeSessions: number
}

export interface PanelSession {
  tokenPrefix: string
  userId: number
  username: string
  role: PanelRole
  createdAt: number
  expiresAt: number
  ip: string | null
  userAgent: string | null
  current: boolean
}

export interface PanelUsersOverview {
  ts: number
  users: PanelUser[]
  sessions: PanelSession[]
}

export interface AuthHostSummary {
  hostname: string
  platform: string
  arch: string
  ncpu: number
  uptime: number
  gpu?: {
    name: string
    vendor: string
    count: number
  } | null
}

export interface AuthStatus {
  setup: boolean
  authenticated: boolean
  user: AuthUser | null
  sessionExpiresAt: number | null
  host?: AuthHostSummary
}

export const api = {
  authStatus: () => getJson<AuthStatus>('/api/auth/status'),
  authSetup: (username: string, password: string) =>
    postJson<{ ok: boolean; user: AuthUser }>('/api/auth/setup', { username, password }),
  authLogin: (username: string, password: string) =>
    postJson<{ ok: boolean; user: AuthUser }>('/api/auth/login', { username, password }),
  authLogout: () => postJson<{ ok: boolean }>('/api/auth/logout'),
  authMe: () => getJson<{ user: AuthUser; sessionExpiresAt: number }>('/api/auth/me'),
  authChangePassword: (currentPassword: string, newPassword: string) =>
    postJson<{ ok: boolean }>('/api/auth/password', { currentPassword, newPassword }),
  panelUsersOverview: () => getJson<PanelUsersOverview>('/api/auth/users'),
  panelCreateUser: (input: { username: string; password: string; role: PanelRole }) =>
    postJson<PanelUsersOverview>('/api/auth/users/create', input),
  panelUpdateUser: (input: { id: number; role?: PanelRole; password?: string }) =>
    postJson<PanelUsersOverview>('/api/auth/users/update', input),
  panelDeleteUser: (id: number) =>
    postJson<PanelUsersOverview>('/api/auth/users/delete', { id }),
  panelRevokeSession: (tokenPrefix: string) =>
    postJson<PanelUsersOverview>('/api/auth/sessions/revoke', { tokenPrefix }),
  panelRevokeOtherSessions: () =>
    postJson<PanelUsersOverview>('/api/auth/sessions/revoke', { allOthers: true }),
  system: () => getJson<SystemInfo>('/api/system'),
  gpu: () => getJson<GpuSummary>('/api/gpu'),
  processes: () => getJson<ProcessesResponse>('/api/processes'),
  memory: () => getJson<MemoryInfo>('/api/memory'),
  fs: (path = '/') => getJson<{ path: string; fs: FsInfo }>(`/api/fs?path=${encodeURIComponent(path)}`),
  disks: () => getJson<DisksResponse>('/api/disks'),
  network: () => getJson<NetworkResponse>('/api/network'),
  metrics: () => getJson<MetricsResponse>('/api/metrics'),
  history: () => getJson<HistoryResponse>('/api/history'),
  connections: (limit = 300) => getJson<ConnectionsResponse>(`/api/connections?limit=${limit}`),
  dockerOverview: () => getJson<DockerOverview>('/api/docker/overview'),
  dockerLogs: (id: string, tail = 200) =>
    getJson<DockerLogs>(`/api/docker/logs?id=${encodeURIComponent(id)}&tail=${tail}`),
  dockerInspect: (id: string) => getJson<DockerInspect>(`/api/docker/inspect?id=${encodeURIComponent(id)}`),
  dockerAction: (id: string, action: string) =>
    postJson<DockerActionResponse>('/api/docker/action', { id, action }),
  nginxOverview: () => getJson<NginxOverview>('/api/nginx/overview'),
  nginxTest: () => postJson<NginxTestResult>('/api/nginx/test'),
  nginxAction: (action: 'start' | 'stop' | 'restart' | 'reload') =>
    postJson<NginxActionResult>('/api/nginx/action', { action }),
  nginxReadFile: (name: string, scope: NginxScope = 'site') =>
    getJson<NginxFileResponse>(`/api/nginx/file?name=${encodeURIComponent(name)}&scope=${encodeURIComponent(scope)}`),
  nginxSaveSite: (input: {
    name: string
    scope?: NginxScope
    content: string
    enable?: boolean
    reloadAfter?: boolean
  }) => postJson<NginxMutationResult>('/api/nginx/site/save', input),
  nginxToggleSite: (input: {
    name: string
    scope?: NginxScope
    enabled: boolean
    reloadAfter?: boolean
  }) => postJson<NginxMutationResult>('/api/nginx/site/toggle', input),
  nginxDeleteSite: (input: {
    name: string
    scope?: NginxScope
    reloadAfter?: boolean
  }) => postJson<NginxMutationResult>('/api/nginx/site/delete', input),
  nginxLogs: (kind: 'access' | 'error' | 'journal' = 'error', lines = 120) =>
    getJson<NginxLogsResponse>(`/api/nginx/logs?kind=${encodeURIComponent(kind)}&lines=${lines}`),
  procManagersOverview: () => getJson<ProcManagersOverview>('/api/proc-managers/overview'),
  procManagerAction: (input: {
    engine: ProcManagerEngine
    owner: string
    action: 'restart' | 'reload' | 'stop' | 'delete' | 'scale' | 'save' | 'resurrect' | 'kill-daemon'
    target?: string
    instances?: number
  }) => postJson<ProcManagerMutationResult>('/api/proc-managers/action', input),
  procManagerStart: (input: {
    engine: ProcManagerEngine
    owner: string
    script: string
    name?: string
    namespace?: string
    cwd?: string
    mode?: 'fork' | 'cluster'
    instances?: string | number
    maxMemoryRestart?: string
    cron?: string
    watch?: boolean
    args?: string
  }) => postJson<ProcManagerMutationResult>('/api/proc-managers/start', input),
  procManagerLogs: (params: {
    engine: ProcManagerEngine
    owner: string
    outLog: string
    errLog: string
    lines?: number
  }) =>
    getJson<ProcManagerLogsResponse>(
      `/api/proc-managers/logs?engine=${encodeURIComponent(params.engine)}&owner=${encodeURIComponent(params.owner)}&outLog=${encodeURIComponent(params.outLog)}&errLog=${encodeURIComponent(params.errLog)}&lines=${params.lines ?? 120}`
    ),
  procManagerInstall: (owner?: string) =>
    postJson<ProcManagerMutationResult>('/api/proc-managers/install-procman', { owner }),
  kill: (pid: number, signal = 'TERM') =>
    postJson<{ ok: boolean; pid: number; signal: string }>('/api/kill', { pid, signal }),
  cleanTasks: () => getJson<CleanTasksResponse>('/api/clean/tasks'),
  cleanRun: (id: string, paths?: string[]) => postJson<CleanRunResult>('/api/clean/run', { id, paths }),
  osUsers: () => getJson<OsUsersOverview>('/api/os-users'),
  osConfigureSudo: (username: string, password: string) =>
    postJson<{ ok: boolean; sudo: OsSudoStatus }>('/api/os-users/sudo', { username, password }),
  osClearSudo: () => postJson<{ ok: boolean; sudo: OsSudoStatus }>('/api/os-users/sudo/clear'),
  osCreateUser: (input: {
    username: string
    fullName?: string
    shell?: string
    password: string
    groups?: string[]
    createHome?: boolean
  }) => postJson<OsUsersOverview>('/api/os-users/create', input),
  osUpdateUser: (input: {
    username: string
    fullName?: string
    shell?: string
    password?: string
    groups?: string[]
    locked?: boolean
  }) => postJson<OsUsersOverview>('/api/os-users/update', input),
  osDeleteUser: (username: string, removeHome = false) =>
    postJson<OsUsersOverview>('/api/os-users/delete', { username, removeHome }),
  sshOverview: () => getJson<SshOverview>('/api/ssh/overview'),
  sshServerDetail: (id: number, limit = 120, force = false) =>
    getJson<{ ts: number; server: SshServer }>(`/api/ssh/server/detail?id=${id}&limit=${limit}${force ? '&force=1' : ''}`),
  sshRunbooks: () => getJson<{ runbooks: SshRunbook[] }>('/api/ssh/runbooks'),
  sshExecRunbook: (serverId: number, runbookId: string, confirmName?: string) =>
    postJson<SshRunbookResult>('/api/ssh/runbooks/exec', { serverId, runbookId, confirmName }),
  sshResetHostKey: (serverId: number) =>
    postJson<{ ok: boolean; removed: number; metrics: SshSnapshot }>('/api/ssh/hostkey/reset', { serverId }),
  sshAudit: (serverId?: number | null, limit = 80) =>
    getJson<{ items: SshAuditItem[] }>(
      `/api/ssh/audit?limit=${limit}${serverId != null ? `&serverId=${serverId}` : ''}`
    ),
  sshConfig: () => getJson<SshConfigResponse>('/api/ssh/config'),
  sshCreateCluster: (name: string, logo?: string | null) =>
    postJson<{ ok: boolean; cluster: { id: number; name: string; logo: string | null } }>('/api/ssh/clusters', { name, logo }),
  sshUpdateCluster: (id: number, input: { name?: string; logo?: string | null }) =>
    postJson<{ ok: boolean; cluster: { id: number; name: string; logo: string | null } }>('/api/ssh/clusters/update', { id, ...input }),
  sshDeleteCluster: (id: number) => postJson<{ ok: boolean }>('/api/ssh/clusters/delete', { id }),
  sshCreateServer: (input: SshServerInput) =>
    postJson<{ ok: boolean; server: SshServer }>('/api/ssh/servers', input),
  sshUpdateServer: (id: number, input: SshServerInput) =>
    postJson<{ ok: boolean; server: SshServer }>('/api/ssh/servers/update', { id, ...input }),
  sshDeleteServer: (id: number) => postJson<{ ok: boolean }>('/api/ssh/servers/delete', { id }),
  sshTestServer: (id: number) => postJson<SshTestResult>('/api/ssh/servers/test', { id }),
}
