import { execFile } from 'node:child_process';
import { DOCKER_BIN } from './config.js';

function run(args, { timeout = 15000, maxBuffer = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(DOCKER_BIN, args, { timeout, maxBuffer }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: err ? String(err.message || err) : null,
      });
    });
  });
}

function jsonLines(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* linha não-JSON (avisos do docker) é ignorada */
    }
  }
  return out;
}

function label(labels, key) {
  if (!labels) return null;
  const m = String(labels).match(new RegExp(`${key}=([^,]*)`));
  return m ? m[1] : null;
}

let versionCache = { ts: 0, available: null, version: null, error: null };

export async function getDockerStatus() {
  if (Date.now() - versionCache.ts < 30000) return versionCache;
  const r = await run(['version', '--format', '{{.Server.Version}}'], { timeout: 6000 });
  versionCache = {
    ts: Date.now(),
    available: r.ok && !!r.stdout.trim(),
    version: r.stdout.trim() || null,
    error: r.ok ? null : (r.stderr || r.error || '').split('\n')[0] || 'docker indisponível',
  };
  return versionCache;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

let statsCache = { ts: 0, byId: {} };

async function getStats() {
  if (Date.now() - statsCache.ts < 5000) return statsCache.byId;
  const r = await run(['stats', '--no-stream', '--format', '{{json .}}'], { timeout: 20000 });
  const byId = {};
  for (const s of jsonLines(r.stdout)) {
    byId[s.ID] = {
      cpu: parseFloat(String(s.CPUPerc || '0').replace('%', '')) || 0,
      memPct: parseFloat(String(s.MemPerc || '0').replace('%', '')) || 0,
      memUsage: s.MemUsage || null,
      netIO: s.NetIO || null,
      blockIO: s.BlockIO || null,
      pids: Number(s.PIDs) || 0,
    };
  }
  statsCache = { ts: Date.now(), byId };
  return byId;
}

export async function getContainers() {
  const status = await getDockerStatus();
  if (!status.available) return { available: false, error: status.error, containers: [], counts: {} };
  const r = await run(['ps', '-a', '--format', '{{json .}}']);
  if (!r.ok) return { available: true, error: (r.stderr || r.error || '').split('\n')[0], containers: [], counts: {} };
  const stats = await getStats().catch(() => ({}));
  const containers = jsonLines(r.stdout).map((c) => ({
    id: c.ID,
    name: c.Names,
    image: c.Image,
    command: c.Command,
    state: c.State,
    status: c.Status,
    ports: c.Ports || '',
    createdAt: c.CreatedAt,
    runningFor: c.RunningFor,
    size: c.Size || null,
    networks: c.Networks || null,
    mounts: c.Mounts || null,
    project: label(c.Labels, 'com\\.docker\\.compose\\.project'),
    service: label(c.Labels, 'com\\.docker\\.compose\\.service'),
    stats: stats[c.ID] || null,
  }));
  const counts = containers.reduce((acc, c) => {
    acc[c.state] = (acc[c.state] || 0) + 1;
    return acc;
  }, {});
  return { available: true, error: null, version: status.version, counts, containers };
}

export async function getImages() {
  const status = await getDockerStatus();
  if (!status.available) return { available: false, images: [] };
  const r = await run(['images', '--format', '{{json .}}']);
  const images = jsonLines(r.stdout).map((i) => ({
    id: i.ID,
    repository: i.Repository,
    tag: i.Tag,
    size: i.Size,
    createdSince: i.CreatedSince,
    containers: Number(i.Containers) || 0,
    dangling: i.Repository === '<none>',
  }));
  return { available: true, images };
}

export async function getSystemDf() {
  const { available } = await getDockerStatus();
  if (!available) return { available: false, rows: [] };
  const r = await run(['system', 'df', '--format', '{{json .}}']);
  return { available: true, rows: jsonLines(r.stdout) };
}

export async function getLogs(id, tail = 200) {
  if (!isValidId(id)) return { ok: false, error: 'id inválido', logs: '' };
  const n = Math.min(Math.max(Number(tail) || 200, 1), 2000);
  const r = await run(['logs', '--tail', String(n), id], { timeout: 15000 });
  return { ok: r.ok, error: r.ok ? null : (r.stderr || r.error || '').split('\n')[0], logs: r.stdout || '', warnings: r.stderr && !r.ok ? '' : r.stderr };
}

export async function getInspect(id) {
  if (!isValidId(id)) return { ok: false, error: 'id inválido' };
  const r = await run(['inspect', id], { timeout: 10000 });
  if (!r.ok) return { ok: false, error: (r.stderr || r.error || '').split('\n')[0] };
  try {
    const [data] = JSON.parse(r.stdout);
    return {
      ok: true,
      data: {
        id: data.Id,
        name: String(data.Name || '').replace(/^\//, ''),
        created: data.Created,
        restartCount: data.RestartCount,
        startedAt: data.State?.StartedAt,
        finishedAt: data.State?.FinishedAt,
        health: data.State?.Health?.Status || null,
        env: (data.Config?.Env || []).map((e) => e.split('=')[0]),
        cmd: data.Config?.Cmd,
        entrypoint: data.Config?.Entrypoint,
        workdir: data.Config?.WorkingDir,
        ports: data.NetworkSettings?.Ports,
        networks: Object.keys(data.NetworkSettings?.Networks || {}),
        mounts: (data.Mounts || []).map((m) => ({ source: m.Source, dest: m.Destination, mode: m.Mode })),
        restartPolicy: data.HostConfig?.RestartPolicy?.Name,
        memoryLimit: data.HostConfig?.Memory || 0,
        cpuShares: data.HostConfig?.CpuShares || 0,
      },
    };
  } catch {
    return { ok: false, error: 'falha ao ler inspect' };
  }
}

const ACTIONS = new Set(['start', 'stop', 'restart', 'pause', 'unpause', 'kill']);

export async function runAction(id, action, timeout = 30000) {
  if (!isValidId(id)) return { ok: false, error: 'id inválido' };
  if (!ACTIONS.has(action)) return { ok: false, error: `ação não permitida: ${action}` };
  statsCache = { ts: 0, byId: {} };
  const r = await run([action, id], { timeout });
  return {
    ok: r.ok,
    action,
    id,
    error: r.ok ? null : (r.stderr || r.error || '').split('\n').filter(Boolean)[0] || 'falhou',
    output: [r.stdout, r.stderr].filter(Boolean).join('\n').trim() || null,
  };
}

export function invalidateStats() {
  statsCache = { ts: 0, byId: {} };
}
