import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  SSHPASS_BIN,
  SSH_BIN,
  SSH_CACHE_MS,
  SSH_COMMAND_TIMEOUT,
  SSH_CONCURRENCY,
  SSH_CONFIG_FILE,
  SSH_CONNECT_TIMEOUT,
} from './config.js';
import { decryptSecret } from './secrets.js';

const KNOWN_HOSTS = path.join(DATA_DIR, 'known_hosts');

const VIRTUAL_IFACE = /^(lo|veth|br-|docker|virbr|tun|tap|vnet|dummy|sit|bond|wg)/;
const PSEUDO_FS = /^(tmpfs|devtmpfs|shm|none|ramfs|udev)$/;

const REMOTE_CMD = [
  'LC_ALL=C',
  'echo "@@UNAME"; uname -sr',
  'echo "@@HOST"; hostname',
  'echo "@@NCPU"; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo',
  'echo "@@LOAD"; cat /proc/loadavg',
  'echo "@@UPTIME"; cat /proc/uptime',
  'echo "@@STAT1"; head -n1 /proc/stat',
  'echo "@@MEM"; cat /proc/meminfo',
  'echo "@@DF"; df -kP',
  'echo "@@NET"; cat /proc/net/dev',
  'sleep 0.5',
  'echo "@@STAT2"; head -n1 /proc/stat',
].join('; ');

/* ------------------------------- validation ------------------------------ */

const HOST_RE = /^[A-Za-z0-9._:-]+$/;
const USER_RE = /^[A-Za-z0-9._-]{1,32}$/;

export function validateTarget({ host, port, username, authType }) {
  const system = authType === 'system';
  const h = String(host ?? '').trim();
  if (!h || h.length > 255 || h.startsWith('-') || !HOST_RE.test(h)) return 'host inválido';
  const p = Number(port);
  if (!Number.isInteger(p) || p < (system ? 0 : 1) || p > 65535) return 'porta inválida';
  if (system) {
    if (username && !USER_RE.test(String(username))) return 'usuário inválido';
  } else if (!USER_RE.test(String(username ?? ''))) {
    return 'usuário inválido';
  }
  return null;
}

export function validateServer(input, { requireSecret = true } = {}) {
  const name = String(input?.name ?? '').trim();
  if (name.length < 1 || name.length > 60) return { error: 'o nome precisa ter de 1 a 60 caracteres' };
  const authType = input?.authType === 'password' ? 'password' : input?.authType === 'system' ? 'system' : 'key';
  const targetError = validateTarget({ ...input, authType });
  if (targetError) return { error: targetError };
  const secret = input?.secret == null ? '' : String(input.secret).trim();
  if (requireSecret && authType !== 'system' && !secret) {
    return { error: authType === 'password' ? 'informe a senha' : 'informe o caminho da chave privada' };
  }
  if (authType === 'key' && secret.includes('\n')) return { error: 'caminho de chave inválido' };
  return {
    value: {
      name,
      host: String(input.host).trim(),
      port: Number(input.port) || 0,
      username: String(input.username ?? '').trim(),
      authType,
      secret,
    },
  };
}

/* -------------------------------- executor ------------------------------- */

function cleanError(r) {
  if (r.code === 'ENOENT') return 'binário ssh/sshpass não encontrado no host';
  const lines = `${r.stderr || ''}`.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (last) return last;
  return (r.error || 'falha na conexão').split('\n')[0];
}

function execSsh(server, secret) {
  const mode = server.authType === 'password' ? 'password' : server.authType === 'system' ? 'system' : 'key';
  const args = [
    '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${KNOWN_HOSTS}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'LogLevel=ERROR',
  ];
  if (server.port) args.push('-p', String(server.port));
  const target = server.username ? `${server.username}@${server.host}` : server.host;

  if (mode === 'password') {
    args.push('-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password', '-o', 'NumberOfPasswordPrompts=1', target, REMOTE_CMD);
  } else if (mode === 'key') {
    args.push('-o', 'BatchMode=yes', '-o', 'PreferredAuthentications=publickey', '-i', secret, target, REMOTE_CMD);
  } else {
    // system: usa ~/.ssh/config, ssh-agent e chaves padrão do usuário do painel
    args.push('-o', 'BatchMode=yes', target, REMOTE_CMD);
  }

  const file = mode === 'password' ? SSHPASS_BIN : SSH_BIN;
  const finalArgs = mode === 'password' ? ['-e', SSH_BIN, ...args] : args;
  const env = mode === 'password' ? { ...process.env, SSHPASS: secret } : process.env;

  return new Promise((resolve) => {
    execFile(
      file,
      finalArgs,
      { timeout: (SSH_COMMAND_TIMEOUT + SSH_CONNECT_TIMEOUT) * 1000, maxBuffer: 4 * 1024 * 1024, env },
      (err, stdout, stderr) => {
        if (mode === 'password' && err?.code === 'ENOENT') {
          return resolve({ ok: false, code: 'ENOENT', stdout: '', stderr: 'sshpass ausente', error: 'sshpass não instalado' });
        }
        resolve({
          ok: !err,
          code: typeof err?.code === 'number' ? err.code : err?.code ?? (err ? 1 : 0),
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err ? String(err.message || err) : null,
        });
      },
    );
  });
}

/* ----------------------------- ~/.ssh/config ----------------------------- */

export function readSshConfig() {
  let text;
  try {
    text = readFileSync(SSH_CONFIG_FILE, 'utf8');
  } catch {
    return { file: SSH_CONFIG_FILE, exists: false, hosts: [] };
  }

  const blocks = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.aliases.length) blocks.push(cur);
    cur = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z]+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'host') {
      flush();
      const aliases = val.split(/\s+/).filter((a) => a && !/[*?!]/.test(a));
      cur = { aliases, hostName: null, user: null, port: null, identityFile: null, proxyJump: null };
      if (!aliases.length) cur = null;
    } else if (cur) {
      if (key === 'hostname') cur.hostName = val;
      else if (key === 'user') cur.user = val;
      else if (key === 'port') cur.port = Number(val) || null;
      else if (key === 'identityfile') cur.identityFile = val;
      else if (key === 'proxyjump') cur.proxyJump = val;
    }
  }
  flush();

  const hosts = [];
  for (const b of blocks) {
    for (const alias of b.aliases) {
      hosts.push({
        alias,
        hostName: b.hostName,
        user: b.user,
        port: b.port,
        identityFile: b.identityFile,
        proxyJump: b.proxyJump,
      });
    }
  }
  hosts.sort((a, b) => a.alias.localeCompare(b.alias));
  return { file: SSH_CONFIG_FILE, exists: true, hosts };
}

/* -------------------------------- parsing -------------------------------- */

function parseSections(text) {
  const out = {};
  let cur = null;
  for (const line of String(text).split('\n')) {
    const m = line.match(/^@@([A-Z0-9]+)\s*$/);
    if (m) {
      cur = m[1];
      out[cur] = [];
      continue;
    }
    if (cur) out[cur].push(line);
  }
  return out;
}

function first(lines) {
  return (lines || []).map((l) => l.trim()).find(Boolean) ?? null;
}

function parseCpu(stat1, stat2) {
  const parse = (line) => {
    const parts = String(line || '').trim().split(/\s+/).slice(1).map(Number);
    const idle = (parts[3] || 0) + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    return { idle, total };
  };
  const a = parse(first(stat1));
  const b = parse(first(stat2));
  const dt = b.total - a.total;
  if (dt <= 0) return 0;
  return Math.max(0, Math.min(100, ((dt - (b.idle - a.idle)) / dt) * 100));
}

function parseMem(lines) {
  const m = {};
  for (const l of lines || []) {
    const mm = l.match(/^(\w+):\s+(\d+)/);
    if (mm) m[mm[1]] = Number(mm[2]) * 1024;
  }
  const total = m.MemTotal || 0;
  const available = m.MemAvailable ?? m.MemFree ?? 0;
  const used = Math.max(0, total - available);
  const swapTotal = m.SwapTotal || 0;
  const swapFree = m.SwapFree || 0;
  return {
    total,
    used,
    free: m.MemFree || 0,
    available,
    buffers: m.Buffers || 0,
    cached: (m.Cached || 0) + (m.SReclaimable || 0),
    swapTotal,
    swapUsed: Math.max(0, swapTotal - swapFree),
    memPct: total ? (used / total) * 100 : 0,
  };
}

function parseDisks(lines) {
  const out = [];
  for (const l of (lines || []).slice(1)) {
    const t = l.trim();
    if (!t || t.startsWith('Filesystem')) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 6) continue;
    const [fs, blocks, used, avail, pct, ...mountParts] = parts;
    if (PSEUDO_FS.test(fs)) continue;
    const total = Number(blocks) * 1024;
    if (!Number.isFinite(total) || total <= 0) continue;
    out.push({
      fs,
      mount: mountParts.join(' '),
      total,
      used: Number(used) * 1024,
      avail: Number(avail) * 1024,
      usedPct: Number.parseFloat(pct) || 0,
    });
  }
  return out;
}

function parseNet(lines) {
  const ifaces = [];
  for (const l of (lines || []).slice(2)) {
    const t = l.trim();
    const idx = t.indexOf(':');
    if (!t || idx < 0) continue;
    const name = t.slice(0, idx).trim();
    if (!name) continue;
    const f = t.slice(idx + 1).trim().split(/\s+/).map(Number);
    ifaces.push({ name, rx: f[0] || 0, tx: f[8] || 0 });
  }
  return ifaces;
}

function primaryDisk(disks) {
  if (!disks.length) return null;
  return disks.find((d) => d.mount === '/') ?? [...disks].sort((a, b) => b.total - a.total)[0];
}

/* --------------------------------- cache --------------------------------- */

const cache = new Map();

function buildSnapshot(server, parsed) {
  const now = Date.now();
  const prev = cache.get(server.id);
  const prevRates = prev?.rates ?? null;
  const prevTs = prev?.ts ?? null;
  const dt = prevTs ? Math.max(0.001, (now - prevTs) / 1000) : 0;

  const raw = parseNet(parsed.NET);
  const rates = {};
  const interfaces = raw.map((i) => {
    const before = prevRates?.[i.name];
    const rxRate = dt && before ? Math.round(Math.max(0, (i.rx - before.rx) / dt)) : 0;
    const txRate = dt && before ? Math.round(Math.max(0, (i.tx - before.tx) / dt)) : 0;
    rates[i.name] = { rx: i.rx, tx: i.tx };
    return { name: i.name, rx: i.rx, tx: i.tx, rxRate, txRate, virtual: VIRTUAL_IFACE.test(i.name) };
  });

  const active = interfaces.filter((i) => !i.virtual);
  const network = {
    rxRate: active.reduce((a, i) => a + i.rxRate, 0),
    txRate: active.reduce((a, i) => a + i.txRate, 0),
    rxTotal: active.reduce((a, i) => a + i.rx, 0),
    txTotal: active.reduce((a, i) => a + i.tx, 0),
    interfaces,
  };

  const disks = parseDisks(parsed.DF);
  const ncpu = Number.parseInt(first(parsed.NCPU) ?? '', 10);
  const loadParts = (first(parsed.LOAD) ?? '').split(/\s+/).slice(0, 3).map(Number);
  const uptime = Number.parseFloat(first(parsed.UPTIME) ?? '') || null;

  const snapshot = {
    id: server.id,
    online: true,
    ts: now,
    error: null,
    lastSeen: now,
    uname: first(parsed.UNAME),
    hostname: first(parsed.HOST),
    ncpu: Number.isFinite(ncpu) ? ncpu : null,
    uptime,
    loadavg: loadParts.length === 3 && loadParts.every(Number.isFinite) ? loadParts : null,
    cpuUsage: parseCpu(parsed.STAT1, parsed.STAT2),
    memory: parseMem(parsed.MEM),
    disks,
    primaryDisk: primaryDisk(disks),
    network,
    collectMs: null,
  };

  return { snapshot, rates };
}

/* --------------------------------- public -------------------------------- */

export async function collectServer(server, { force = false } = {}) {
  const now = Date.now();
  const hit = cache.get(server.id);
  if (!force && hit && now - hit.ts < SSH_CACHE_MS) return hit.snapshot;

  let secret = null;
  if (server.authType !== 'system') {
    try {
      secret = decryptSecret(server.secretEnc);
    } catch (err) {
      const snapshot = { id: server.id, online: false, ts: now, error: `segredo inválido: ${err.message}`, lastSeen: hit?.snapshot?.lastSeen ?? null };
      cache.set(server.id, { ts: now, rates: hit?.rates ?? null, snapshot });
      return snapshot;
    }
    if (!secret) {
      const snapshot = { id: server.id, online: false, ts: now, error: 'credencial não configurada', lastSeen: hit?.snapshot?.lastSeen ?? null };
      cache.set(server.id, { ts: now, rates: hit?.rates ?? null, snapshot });
      return snapshot;
    }
  }

  const started = Date.now();
  const r = await execSsh(server, secret);
  if (!r.ok) {
    const snapshot = { id: server.id, online: false, ts: now, error: cleanError(r), lastSeen: hit?.snapshot?.lastSeen ?? null };
    cache.set(server.id, { ts: now, rates: hit?.rates ?? null, snapshot });
    return snapshot;
  }

  const parsed = parseSections(r.stdout);
  const { snapshot, rates } = buildSnapshot(server, parsed);
  snapshot.collectMs = Date.now() - started;
  cache.set(server.id, { ts: Date.now(), rates, snapshot });
  return snapshot;
}

export async function collectAll(servers, opts = {}) {
  const queue = [...servers];
  const results = [];
  const workers = Array.from({ length: Math.min(Math.max(1, SSH_CONCURRENCY), queue.length || 1) }, async () => {
    while (queue.length) {
      const s = queue.shift();
      results.push(await collectServer(s, opts));
    }
  });
  await Promise.all(workers);
  return results;
}

export function invalidateServer(id) {
  cache.delete(id);
}

export function cacheSize() {
  return cache.size;
}
