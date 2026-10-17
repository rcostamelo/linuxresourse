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

export interface SystemInfo {
  hostname: string
  platform: string
  arch: string
  uptime: number
  loadavg: [number, number, number]
  ncpu: number
  cpuModel: string
  cpuUsage: number
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

export interface AuthUser {
  id: number
  username: string
  role: string
  createdAt: number
  lastLoginAt: number | null
}

export interface AuthStatus {
  setup: boolean
  authenticated: boolean
  user: AuthUser | null
  sessionExpiresAt: number | null
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
  system: () => getJson<SystemInfo>('/api/system'),
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
