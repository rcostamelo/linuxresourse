import { promises as fsp, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import { readNetDev } from './network.js';
import { sampleGpus } from './gpu.js';
import { sampleCpuTemp } from './cputemp.js';
import { SCAN_ROOT } from './config.js';

const PAGE_SIZE = 4096;
const HZ = 100;
const SAMPLE_MS = 2000;
const HISTORY_MAX = 180;

let users = new Map();
let usersTs = 0;

let snapshot = {
  ts: 0,
  processes: [],
  cpuUsage: 0,
  loadavg: [0, 0, 0],
  network: { rx: 0, tx: 0, perIface: {} },
  gpu: { available: false, count: 0, gpus: [], primary: null },
  cpuTemp: { available: false, temperature: null, cores: [] },
};
let history = [];
let prevTicks = new Map();
let prevTotal = 0;
let prevNet = null;
let prevNetTs = 0;
let timer = null;

async function loadUsers() {
  if (users.size && Date.now() - usersTs < 60_000) return;
  try {
    const passwdFile = SCAN_ROOT && existsSync(`${SCAN_ROOT}/etc/passwd`) ? `${SCAN_ROOT}/etc/passwd` : '/etc/passwd';
    const txt = await fsp.readFile(passwdFile, 'utf8');
    const m = new Map();
    for (const line of txt.split('\n')) {
      const p = line.split(':');
      if (p.length > 2 && p[2]) m.set(Number(p[2]), p[0]);
    }
    users = m;
    usersTs = Date.now();
  } catch {
    /* ignore */
  }
}

async function readCpuTotal() {
  try {
    const txt = await fsp.readFile('/proc/stat', 'utf8');
    const line = txt.slice(0, txt.indexOf('\n')).trim().split(/\s+/).slice(1).map(Number);
    const idle = (line[3] || 0) + (line[4] || 0);
    const total = line.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

async function readUptime() {
  try {
    const txt = await fsp.readFile('/proc/uptime', 'utf8');
    return parseFloat(txt.split(' ')[0]);
  } catch {
    return os.uptime();
  }
}

export async function getMemory() {
  const txt = await fsp.readFile('/proc/meminfo', 'utf8');
  const m = {};
  for (const line of txt.split('\n')) {
    const mm = line.match(/^(\w+):\s+(\d+)/);
    if (mm) m[mm[1]] = Number(mm[2]) * 1024;
  }
  const total = m.MemTotal || 0;
  const available = m.MemAvailable ?? m.MemFree ?? 0;
  const swapTotal = m.SwapTotal || 0;
  return {
    total,
    free: m.MemFree || 0,
    available,
    used: total - available,
    buffers: m.Buffers || 0,
    cached: (m.Cached || 0) + (m.SReclaimable || 0),
    shared: m.Shmem || 0,
    active: m.Active || 0,
    inactive: m.Inactive || 0,
    dirty: m.Dirty || 0,
    swapTotal,
    swapFree: m.SwapFree || 0,
    swapUsed: swapTotal - (m.SwapFree || 0),
  };
}

async function readProcess(pidRaw, dtTotal, ncpu, memTotal, uptimeSec) {
  const pidNum = Number(pidRaw);
  let stat;
  try {
    stat = await fsp.readFile(`/proc/${pidNum}/stat`, 'utf8');
  } catch {
    return null;
  }
  const rp = stat.lastIndexOf(')');
  const open = stat.indexOf('(');
  const name = stat.slice(open + 1, rp);
  const rest = stat.slice(rp + 2).trim().split(/\s+/);
  const state = rest[0];
  const ppid = Number(rest[1]);
  const ticks = Number(rest[11]) + Number(rest[12]);
  const threads = Number(rest[17]);
  const starttime = Number(rest[19]);
  const rssPages = Number(rest[21]);

  let uid = 0;
  try {
    const s = await fsp.readFile(`/proc/${pidNum}/status`, 'utf8');
    const mm = s.match(/^Uid:\s+(\d+)/m);
    if (mm) uid = Number(mm[1]);
  } catch {
    /* ignore */
  }

  let cmdline = '';
  try {
    cmdline = (await fsp.readFile(`/proc/${pidNum}/cmdline`, 'utf8')).replace(/\0/g, ' ').trim();
  } catch {
    /* ignore */
  }

  const p = prevTicks.get(pidNum);
  let cpu = 0;
  if (p && dtTotal > 0) cpu = Math.max(0, ((ticks - p) / dtTotal) * ncpu * 100);

  const rss = rssPages * PAGE_SIZE;
  const elapsedSec = Math.max(0, uptimeSec - starttime / HZ);

  return {
    pid: pidNum,
    ppid,
    name,
    state,
    user: users.get(uid) || String(uid),
    cpu,
    mem: rss,
    memPct: memTotal ? (rss / memTotal) * 100 : 0,
    threads,
    elapsedSec,
    cmdline: cmdline || name,
    ticks,
  };
}

async function sample() {
  const ncpu = os.cpus().length;
  await loadUsers();

  const [mem, uptimeSec, cpu, gpu, cpuTemp] = await Promise.all([
    getMemory(),
    readUptime(),
    readCpuTotal(),
    sampleGpus(),
    sampleCpuTemp(),
  ]);

  let cpuUsage = snapshot.cpuUsage;
  let dtTotal = 0;
  if (cpu && prevTotal) {
    dtTotal = cpu.total - prevTotal;
    const dtIdle = cpu.idle - (snapshot._idle ?? cpu.idle);
    if (dtTotal > 0) cpuUsage = Math.max(0, Math.min(100, (1 - dtIdle / dtTotal) * 100));
  }

  let names = [];
  try {
    names = (await fsp.readdir('/proc')).filter((n) => /^\d+$/.test(n));
  } catch {
    /* ignore */
  }

  const processes = [];
  const nextTicks = new Map();
  for (const pid of names) {
    const p = await readProcess(pid, dtTotal, ncpu, mem.total, uptimeSec);
    if (!p) continue;
    nextTicks.set(p.pid, p.ticks);
    delete p.ticks;
    processes.push(p);
  }

  prevTicks = nextTicks;
  if (cpu) prevTotal = cpu.total;

  const now = Date.now();
  const dev = await readNetDev();
  const perIface = {};
  let totalRx = 0;
  let totalTx = 0;
  if (prevNet) {
    const dt = Math.max(0.001, (now - prevNetTs) / 1000);
    for (const [name, cur] of Object.entries(dev)) {
      const p = prevNet[name] || { rx: cur.rx, tx: cur.tx };
      const rx = Math.round(Math.max(0, (cur.rx - p.rx) / dt));
      const tx = Math.round(Math.max(0, (cur.tx - p.tx) / dt));
      perIface[name] = { rx, tx, rxTotal: cur.rx, txTotal: cur.tx, rxErrs: cur.rxErrs, txErrs: cur.txErrs };
      if (name !== 'lo') {
        totalRx += rx;
        totalTx += tx;
      }
    }
  }
  prevNet = dev;
  prevNetTs = now;

  snapshot = {
    ts: now,
    processes,
    cpuUsage,
    loadavg: os.loadavg(),
    network: { rx: totalRx, tx: totalTx, perIface, ts: now },
    gpu,
    cpuTemp,
    _idle: cpu ? cpu.idle : snapshot._idle,
  };

  history.push({
    t: now,
    cpu: cpuUsage,
    mem: mem.total ? (mem.used / mem.total) * 100 : 0,
    memUsed: mem.used,
    rx: totalRx,
    tx: totalTx,
    load: os.loadavg()[0],
    cpuTemp: cpuTemp.temperature ?? null,
    gpu: gpu.primary?.utilization ?? null,
    gpuMem: gpu.primary?.memPct ?? null,
    gpuTemp: gpu.primary?.temperature ?? null,
    gpuPower: gpu.primary?.powerDraw ?? null,
  });
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_MAX);
}

export function startSampler() {
  if (timer) return;
  const loop = async () => {
    try {
      await sample();
    } catch {
      /* keep going */
    }
    timer = setTimeout(loop, SAMPLE_MS);
    timer.unref?.();
  };
  loop();
}

export function getProcesses() {
  return {
    ts: snapshot.ts,
    cpuUsage: snapshot.cpuUsage,
    loadavg: snapshot.loadavg,
    ncpu: os.cpus().length,
    processes: snapshot.processes,
  };
}

function readHostHostname() {
  if (SCAN_ROOT && existsSync(`${SCAN_ROOT}/etc/hostname`)) {
    try {
      const h = readFileSync(`${SCAN_ROOT}/etc/hostname`, 'utf8').trim();
      if (h) return h;
    } catch {
      /* ignore */
    }
  }
  return os.hostname();
}

export function getCpuTemp() {
  return snapshot.cpuTemp;
}

export function getGpu() {
  return snapshot.gpu;
}

export function getSystem() {
  const cpus = os.cpus();
  return {
    hostname: readHostHostname(),
    platform: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    uptime: os.uptime(),
    loadavg: os.loadavg(),
    ncpu: cpus.length,
    cpuModel: cpus[0]?.model || 'CPU',
    cpuUsage: snapshot.cpuUsage,
    cpuTemp: snapshot.cpuTemp,
    gpu: snapshot.gpu,
  };
}

export function getNetworkRates() {
  return snapshot.network;
}

export function getHistory() {
  return { ts: Date.now(), points: history };
}

const SIGNALS = { TERM: 'SIGTERM', KILL: 'SIGKILL', STOP: 'SIGSTOP', CONT: 'SIGCONT', INT: 'SIGINT', HUP: 'SIGHUP' };

export function killProcess(pid, signal) {
  const sig = SIGNALS[String(signal || 'TERM').toUpperCase()] || 'SIGTERM';
  if (!Number.isInteger(pid) || pid <= 1) throw new Error('pid inválido');
  process.kill(pid, sig);
  return { pid, signal: sig };
}
