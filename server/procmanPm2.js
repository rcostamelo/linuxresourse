import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { getProcesses } from './system.js';
import {
  IS_HOST_MOUNT,
  hostPath,
  readPasswdUsers,
  getSudoStatus,
  getSavedSudoMeta,
  execHostSudo,
} from './osUsers.js';
import { recordSshAudit } from './db.js';

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function execLocal(bin, args, { timeout = 15000, env = process.env, cwd = undefined } = {}) {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout, maxBuffer: 16 * 1024 * 1024, env, cwd },
      (err, stdout, stderr) => {
        resolve({
          code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err ? String(err.message || err) : null,
        });
      }
    );
  });
}

function safeReadFile(fullPath, maxBytes = 512 * 1024) {
  try {
    const st = statSync(fullPath);
    if (!st.isFile()) return '';
    if (st.size <= maxBytes) {
      return readFileSync(fullPath, 'utf8');
    }
    const buf = readFileSync(fullPath);
    return buf.subarray(buf.length - maxBytes).toString('utf8');
  } catch {
    return '';
  }
}

function canReadHostDir(dirPath) {
  if (!dirPath) return false;
  try {
    readdirSync(hostPath(dirPath));
    return true;
  } catch {
    return false;
  }
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  return existsSync(`/proc/${n}`);
}

function parseSemverDir(a, b) {
  const va = String(a).replace(/^v/i, '').split('.').map(Number);
  const vb = String(b).replace(/^v/i, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (vb[i] || 0) - (va[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Descobre diretórios de binários Node (NVM, FNM, Volta, global) de um usuário no host.
 */
function findUserBinDirs(userHome) {
  const dirs = [];
  if (userHome) {
    // 1. NVM: ~/.nvm/versions/node/<v>/bin
    const nvmVersions = hostPath(path.join(userHome, '.nvm/versions/node'));
    if (existsSync(nvmVersions)) {
      try {
        const vers = readdirSync(nvmVersions).sort(parseSemverDir);
        for (const v of vers) {
          const binDir = path.join(userHome, '.nvm/versions/node', v, 'bin');
          if (existsSync(hostPath(binDir))) dirs.push(binDir);
        }
      } catch {
        /* ignore */
      }
    }

    // 2. FNM: ~/.local/share/fnm/node-versions/<v>/installation/bin
    const fnmVersions = hostPath(path.join(userHome, '.local/share/fnm/node-versions'));
    if (existsSync(fnmVersions)) {
      try {
        const vers = readdirSync(fnmVersions).sort(parseSemverDir);
        for (const v of vers) {
          const binDir = path.join(
            userHome,
            '.local/share/fnm/node-versions',
            v,
            'installation/bin'
          );
          if (existsSync(hostPath(binDir))) dirs.push(binDir);
        }
      } catch {
        /* ignore */
      }
    }

    // 3. Volta, PNPM, Bun, ~/.local/bin
    for (const rel of ['.volta/bin', '.local/share/pnpm', '.bun/bin', '.local/bin', 'bin']) {
      const d = path.join(userHome, rel);
      if (existsSync(hostPath(d))) dirs.push(d);
    }
  }

  for (const sysDir of ['/usr/local/bin', '/usr/bin', '/bin']) {
    if (!dirs.includes(sysDir)) dirs.push(sysDir);
  }
  return dirs;
}

function findBinInDirs(binName, dirs) {
  for (const d of dirs) {
    const candidate = path.join(d, binName);
    if (existsSync(hostPath(candidate))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Descobre todos os usuários relevantes e seus caminhos de procman / pm2 / node.
 */
export function discoverUserEnvironments() {
  const passwdUsers = readPasswdUsers();
  const byUsername = new Map();

  for (const u of passwdUsers) {
    const readableHome = canReadHostDir(u.home);
    const hasProcman = readableHome && u.home && existsSync(hostPath(path.join(u.home, '.procman')));
    const hasPm2 = readableHome && u.home && existsSync(hostPath(path.join(u.home, '.pm2')));
    if (!u.isHuman && !hasProcman && !hasPm2) continue;

    const binDirs = findUserBinDirs(u.home);
    const nodeBin = findBinInDirs('node', binDirs);
    let procmanBin = findBinInDirs('procman', binDirs);
    const pm2Bin = findBinInDirs('pm2', binDirs);

    if (!procmanBin && u.home && existsSync(hostPath(path.join(u.home, 'procman/bin/procman.js')))) {
      procmanBin = path.join(u.home, 'procman/bin/procman.js');
    }

    byUsername.set(u.username, {
      username: u.username,
      uid: u.uid,
      gid: u.gid,
      home: u.home,
      readableHome,
      shell: u.shell,
      binDirs,
      nodeBin,
      procmanBin,
      pm2Bin,
      procmanHome: u.home ? path.join(u.home, '.procman') : null,
      pm2Home: u.home ? path.join(u.home, '.pm2') : null,
    });
  }

  let anyProcmanBin = null;
  let anyPm2Bin = null;
  let anyNodeBin = null;
  for (const env of byUsername.values()) {
    if (!anyProcmanBin && env.procmanBin) anyProcmanBin = env.procmanBin;
    if (!anyPm2Bin && env.pm2Bin) anyPm2Bin = env.pm2Bin;
    if (!anyNodeBin && env.nodeBin) anyNodeBin = env.nodeBin;
  }

  for (const env of byUsername.values()) {
    if (!env.nodeBin && anyNodeBin) env.nodeBin = anyNodeBin;
    if (!env.procmanBin && anyProcmanBin) env.procmanBin = anyProcmanBin;
    if (!env.pm2Bin && anyPm2Bin) env.pm2Bin = anyPm2Bin;
  }

  return {
    byUsername,
    anyProcmanBin,
    anyPm2Bin,
    anyNodeBin,
  };
}

/* ------------------------ Probe para Diretórios 0700 (ex: /root) ----------- */

const restrictedHomeCache = new Map(); // username -> { ts, data }

async function probeRestrictedHome(ownerEnv, canSudo = false) {
  if (!ownerEnv.home || ownerEnv.readableHome) return null;
  if (!canSudo) return null;

  const cached = restrictedHomeCache.get(ownerEnv.username);
  if (cached && Date.now() - cached.ts < 8000) {
    return cached.data;
  }

  const pHome = ownerEnv.procmanHome;
  const pm2Home = ownerEnv.pm2Home;
  const script = `
    echo "@@PROCMAN_EXISTS"; [ -d ${shQuote(pHome)} ] && echo "1" || echo "0";
    echo "@@PROCMAN_PID"; [ -f ${shQuote(`${pHome}/daemon.pid`)} ] && cat ${shQuote(`${pHome}/daemon.pid`)} 2>/dev/null || true;
    echo "@@PROCMAN_DUMP"; [ -f ${shQuote(`${pHome}/dump.json`)} ] && cat ${shQuote(`${pHome}/dump.json`)} 2>/dev/null || true;
    echo "@@PM2_EXISTS"; [ -d ${shQuote(pm2Home)} ] && echo "1" || echo "0";
    echo "@@PM2_PID"; [ -f ${shQuote(`${pm2Home}/pm2.pid`)} ] && cat ${shQuote(`${pm2Home}/pm2.pid`)} 2>/dev/null || true;
    echo "@@PM2_DUMP"; [ -f ${shQuote(`${pm2Home}/dump.pm2`)} ] && cat ${shQuote(`${pm2Home}/dump.pm2`)} 2>/dev/null || true;
  `;

  const r = await execHostSudo(script, { timeout: 6000 });
  if (r.code !== 0) {
    restrictedHomeCache.set(ownerEnv.username, { ts: Date.now(), data: null });
    return null;
  }

  const sections = {};
  let current = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('@@')) {
      current = line.slice(2).trim();
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }

  const getSec = (k) => (sections[k] || []).join('\n').trim();
  const data = {
    procmanExists: getSec('PROCMAN_EXISTS') === '1',
    procmanPid: Number(getSec('PROCMAN_PID')) || null,
    procmanDumpRaw: getSec('PROCMAN_DUMP'),
    pm2Exists: getSec('PM2_EXISTS') === '1',
    pm2Pid: Number(getSec('PM2_PID')) || null,
    pm2DumpRaw: getSec('PM2_DUMP'),
  };

  restrictedHomeCache.set(ownerEnv.username, { ts: Date.now(), data });
  return data;
}

/* ------------------------ Cliente Socket Nativo do procman ----------------- */

function callProcmanSocket(socketRealPath, method, params = {}, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    if (!existsSync(socketRealPath)) {
      const err = new Error('daemon socket not found');
      err.code = 'ENOENT';
      return reject(err);
    }

    const socket = net.connect(socketRealPath);
    let settled = false;
    let buffer = '';

    const finish = (err, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(val);
    };

    const timer = setTimeout(() => {
      const err = new Error(`procman socket timeout (${timeoutMs}ms)`);
      err.code = 'ETIMEDOUT';
      finish(err);
    }, timeoutMs);

    socket.on('error', (err) => finish(err));
    socket.on('connect', () => {
      const payload = JSON.stringify({ id: Date.now(), method, params }) + '\n';
      socket.write(payload);
    });

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ok) {
            return finish(null, msg.result ?? null);
          }
          const e = new Error(msg.error?.message || 'procman error');
          e.code = msg.error?.message || msg.error?.code || 'ERROR';
          return finish(e);
        } catch (parseErr) {
          return finish(parseErr);
        }
      }
    });
  });
}

/**
 * Executa um comando no host em nome do usuário dono (`ownerEnv`), construindo o PATH com o Node dele.
 */
async function execAsHostOwner(ownerEnv, shellCmd, { timeout = 20000 } = {}) {
  const pathPrefix = ownerEnv.binDirs?.length ? `${ownerEnv.binDirs.join(':')}:$PATH` : '$PATH';
  const envExports = [
    `export PATH="${pathPrefix}"`,
    ownerEnv.home ? `export HOME=${shQuote(ownerEnv.home)}` : '',
    ownerEnv.procmanHome ? `export PROCMAN_HOME=${shQuote(ownerEnv.procmanHome)}` : '',
    ownerEnv.pm2Home ? `export PM2_HOME=${shQuote(ownerEnv.pm2Home)}` : '',
    'export PROCMAN_NO_BANNER=1',
    'export NO_COLOR=1',
  ]
    .filter(Boolean)
    .join('; ');

  const fullInner = `${envExports}; ${shellCmd}`;

  if (!IS_HOST_MOUNT) {
    const curUid = process.getuid?.() ?? -1;
    if (curUid === ownerEnv.uid) {
      return execLocal('sh', ['-c', fullInner], { timeout });
    }
    if (curUid === 0) {
      if (ownerEnv.username === 'root') {
        return execLocal('sh', ['-c', fullInner], { timeout });
      }
      return execLocal('su', [ownerEnv.username, '-s', '/bin/sh', '-c', fullInner], { timeout });
    }
  }

  const wrapped =
    ownerEnv.username === 'root'
      ? fullInner
      : `su ${ownerEnv.username} -s /bin/sh -c ${shQuote(fullInner)}`;
  return execHostSudo(wrapped, { timeout });
}

function readProcEnviron(pid) {
  const env = {};
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, 'utf8');
    for (const pair of raw.split('\0')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq > 0) {
        env[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
    }
  } catch {
    /* sem permissão de leitura direta do environ de outro usuário */
  }
  return env;
}

/* ------------------------ Coleta de Estado do procman ---------------------- */

async function inspectUserProcman(ownerEnv, procByPid, restrictedData, canSudo = false) {
  const pHome = ownerEnv.procmanHome;
  if (!pHome) return null;

  const realHome = hostPath(pHome);
  const pidFile = path.join(realHome, 'daemon.pid');
  const sockFile = path.join(realHome, 'daemon.sock');
  const dumpFile = path.join(realHome, 'dump.json');

  const dirExists = restrictedData ? restrictedData.procmanExists : existsSync(realHome);
  let daemonPid = null;

  if (restrictedData?.procmanPid && isPidAlive(restrictedData.procmanPid)) {
    daemonPid = restrictedData.procmanPid;
  } else if (existsSync(pidFile)) {
    const rawPid = Number(safeReadFile(pidFile).trim());
    if (isPidAlive(rawPid)) daemonPid = rawPid;
  }

  if (!daemonPid) {
    for (const p of procByPid.values()) {
      if (
        p.user === ownerEnv.username &&
        (p.cmdline.includes('procman: daemon') || p.cmdline.includes('lib/daemon.js'))
      ) {
        daemonPid = p.pid;
        break;
      }
    }
  }

  let liveList = null;
  let daemonVersion = null;
  let daemonAlive = Boolean(daemonPid);

  if (existsSync(sockFile)) {
    try {
      const [pingRes, listRes] = await Promise.all([
        callProcmanSocket(sockFile, 'ping', {}, 2000),
        callProcmanSocket(sockFile, 'list', {}, 2500),
      ]);
      daemonAlive = true;
      daemonPid = pingRes?.pid || daemonPid;
      daemonVersion = pingRes?.version || null;
      if (Array.isArray(listRes)) liveList = listRes;
    } catch {
      /* fallback abaixo */
    }
  }

  if (!liveList && daemonPid && ownerEnv.procmanBin && (canSudo || !IS_HOST_MOUNT)) {
    const cmd = `${shQuote(ownerEnv.nodeBin || 'node')} ${shQuote(ownerEnv.procmanBin)} list --json`;
    const r = await execAsHostOwner(ownerEnv, cmd, { timeout: 6000 });
    if (r.code === 0 && r.stdout.trim()) {
      try {
        liveList = JSON.parse(r.stdout.trim());
        daemonAlive = true;
      } catch {
        /* ignore */
      }
    }
  }

  let savedApps = [];
  const dumpRaw = restrictedData ? restrictedData.procmanDumpRaw : existsSync(dumpFile) ? safeReadFile(dumpFile) : '';
  if (dumpRaw) {
    try {
      const parsed = JSON.parse(dumpRaw);
      if (Array.isArray(parsed?.apps)) {
        savedApps = parsed.apps;
      }
    } catch {
      /* ignore */
    }
  }

  if (!dirExists && !daemonAlive && savedApps.length === 0) {
    return null;
  }

  const processes = [];
  const seenNames = new Set();

  if (Array.isArray(liveList)) {
    for (const item of liveList) {
      seenNames.add(`${item.namespace || 'default'}:${item.name}`);
      const pids = Array.isArray(item.pids)
        ? item.pids.map(Number).filter((n) => n > 0)
        : item.pid
          ? [Number(item.pid)].filter((n) => n > 0)
          : [];

      let cpu = Number(item.cpu) || 0;
      let memory = Number(item.memory) || 0;
      if ((cpu === 0 || memory === 0) && pids.length > 0) {
        let sumCpu = 0;
        let sumMem = 0;
        for (const pid of pids) {
          const pr = procByPid.get(pid);
          if (pr) {
            sumCpu += pr.cpu || 0;
            sumMem += pr.mem || 0;
          }
        }
        if (cpu === 0) cpu = Number(sumCpu.toFixed(1));
        if (memory === 0) memory = sumMem;
      }

      processes.push({
        uidKey: `procman:${ownerEnv.username}:${item.id}:${item.name}`,
        engine: 'procman',
        owner: ownerEnv.username,
        ownerUid: ownerEnv.uid,
        id: item.id,
        name: item.name,
        namespace: item.namespace || 'default',
        mode: item.mode || 'fork',
        instances: Number(item.instances) || (pids.length || 1),
        pids,
        pid: item.pid ?? (pids[0] || 0),
        ports: Array.isArray(item.ports) ? item.ports : item.port ? [item.port] : [],
        status: item.status || 'stopped',
        restarts: Number(item.restarts) || 0,
        unstableRestarts: Number(item.unstable_restarts) || 0,
        exitCode: item.exit_code ?? null,
        uptimeMs: Number(item.uptime_ms) || 0,
        cpu,
        memory,
        maxMemoryRestart: item.max_memory_restart || null,
        watch: Boolean(item.watch),
        cron: item.cron || null,
        autorestart: item.autorestart !== false,
        script: item.script || '',
        cwd: item.cwd || '',
        args: Array.isArray(item.args) ? item.args : [],
        outLog: item.out_log || path.join(pHome, 'logs', `${item.id}-${item.name}-out.log`),
        errLog: item.err_log || path.join(pHome, 'logs', `${item.id}-${item.name}-err.log`),
        savedOnly: false,
      });
    }
  }

  savedApps.forEach((app, idx) => {
    const key = `${app.namespace || 'default'}:${app.name}`;
    if (seenNames.has(key)) return;
    const id = processes.length + idx;
    processes.push({
      uidKey: `procman:${ownerEnv.username}:saved:${app.name}:${idx}`,
      engine: 'procman',
      owner: ownerEnv.username,
      ownerUid: ownerEnv.uid,
      id,
      name: app.name || `app-${idx}`,
      namespace: app.namespace || 'default',
      mode: app.mode || 'fork',
      instances: Number(app.instances) || 1,
      pids: [],
      pid: 0,
      ports: [],
      status: 'saved',
      restarts: 0,
      unstableRestarts: 0,
      exitCode: null,
      uptimeMs: 0,
      cpu: 0,
      memory: 0,
      maxMemoryRestart: app.maxMemoryRestart || null,
      watch: Boolean(app.watch),
      cron: app.cron || null,
      autorestart: app.autorestart !== false,
      script: app.script || '',
      cwd: app.cwd || '',
      args: Array.isArray(app.args) ? app.args : [],
      outLog: app.output || path.join(pHome, 'logs', `0-${app.name}-out.log`),
      errLog: app.error || path.join(pHome, 'logs', `0-${app.name}-err.log`),
      savedOnly: true,
    });
  });

  return {
    daemon: {
      engine: 'procman',
      owner: ownerEnv.username,
      ownerUid: ownerEnv.uid,
      stateDir: pHome,
      running: daemonAlive,
      pid: daemonPid,
      version: daemonVersion,
      onlineCount: processes.filter((p) => p.status === 'online').length,
      totalCount: processes.length,
      savedCount: savedApps.length,
      binPath: ownerEnv.procmanBin,
    },
    processes,
  };
}

/* ------------------------ Coleta de Estado do PM2 -------------------------- */

const pm2Cache = new Map();

async function inspectUserPm2(ownerEnv, procByPid, restrictedData, canSudo = false) {
  const pm2Home = ownerEnv.pm2Home;
  if (!pm2Home) return null;

  const realHome = hostPath(pm2Home);
  const pidFile = path.join(realHome, 'pm2.pid');
  const dumpFile = path.join(realHome, 'dump.pm2');
  const dirExists = restrictedData ? restrictedData.pm2Exists : existsSync(realHome);

  let daemonPid = null;
  if (restrictedData?.pm2Pid && isPidAlive(restrictedData.pm2Pid)) {
    daemonPid = restrictedData.pm2Pid;
  } else if (existsSync(pidFile)) {
    const rawPid = Number(safeReadFile(pidFile).trim());
    if (isPidAlive(rawPid)) daemonPid = rawPid;
  }

  if (!daemonPid) {
    for (const p of procByPid.values()) {
      if (p.user === ownerEnv.username && /PM2 v[\d.]+ God Daemon/i.test(p.cmdline)) {
        daemonPid = p.pid;
        break;
      }
    }
  }

  let savedApps = [];
  const dumpRaw = restrictedData ? restrictedData.pm2DumpRaw : existsSync(dumpFile) ? safeReadFile(dumpFile) : '';
  if (dumpRaw) {
    try {
      const parsed = JSON.parse(dumpRaw);
      if (Array.isArray(parsed)) savedApps = parsed;
    } catch {
      /* ignore */
    }
  }

  if (!dirExists && !daemonPid && savedApps.length === 0) {
    return null;
  }

  let liveJlist = null;

  // 1. Inspeção rápida e sem overhead via /proc dos processos filhos do PM2 God Daemon + dump.pm2
  if (daemonPid) {
    const children = [];
    for (const p of procByPid.values()) {
      if (p.ppid === daemonPid) {
        const env = readProcEnviron(p.pid);
        children.push({ proc: p, env });
      }
    }
    if (children.length > 0) {
      liveJlist = children.map(({ proc, env }, idx) => {
        const matchedDump = savedApps[idx] || savedApps.find((a) => proc.cmdline.includes(a.pm_exec_path || a.name || '___')) || {};
        const name = env.name || matchedDump.name || proc.name;
        return {
          pm_id: env.pm_id != null ? Number(env.pm_id) : idx,
          name,
          pid: proc.pid,
          monit: { cpu: proc.cpu, memory: proc.mem },
          pm2_env: {
            status: 'online',
            namespace: env.namespace || matchedDump.namespace || 'default',
            exec_mode: env.exec_mode || matchedDump.exec_mode || 'fork_mode',
            instances: Number(env.instances || matchedDump.instances) || 1,
            restart_time: Number(env.restart_time ?? matchedDump.restart_time) || 0,
            unstable_restarts: Number(env.unstable_restarts ?? matchedDump.unstable_restarts) || 0,
            pm_uptime: Date.now() - (proc.elapsedSec || 0) * 1000,
            pm_exec_path: env.pm_exec_path || matchedDump.pm_exec_path || proc.cmdline,
            pm_cwd: env.pm_cwd || matchedDump.pm_cwd || '',
            pm_out_log_path:
              env.pm_out_log_path ||
              matchedDump.pm_out_log_path ||
              path.join(pm2Home, 'logs', `${name}-out.log`),
            pm_err_log_path:
              env.pm_err_log_path ||
              matchedDump.pm_err_log_path ||
              path.join(pm2Home, 'logs', `${name}-error.log`),
            node_version: env.node_version || matchedDump.node_version || null,
            watch: env.watch === 'true' || Boolean(matchedDump.watch),
            cron_restart: env.cron_restart || matchedDump.cron_restart || null,
            autorestart: env.autorestart !== 'false',
            max_memory_restart: env.max_memory_restart
              ? Number(env.max_memory_restart)
              : matchedDump.max_memory_restart || null,
          },
        };
      });
    }
  }

  // 2. Se o daemon está vivo mas sem filhos diretos detectados e sudo está disponível, consulta pm2 jlist com cache
  if (!liveJlist && daemonPid && ownerEnv.pm2Bin && (canSudo || !IS_HOST_MOUNT)) {
    const cached = pm2Cache.get(ownerEnv.username);
    if (cached && Date.now() - cached.ts < 8000) {
      liveJlist = cached.list;
    } else {
      const cmd = `${shQuote(ownerEnv.nodeBin || 'node')} ${shQuote(ownerEnv.pm2Bin)} jlist`;
      const r = await execAsHostOwner(ownerEnv, cmd, { timeout: 6000 });
      if (r.code === 0 && r.stdout.trim()) {
        try {
          const jsonStart = r.stdout.indexOf('[');
          const jsonEnd = r.stdout.lastIndexOf(']');
          if (jsonStart !== -1 && jsonEnd > jsonStart) {
            liveJlist = JSON.parse(r.stdout.slice(jsonStart, jsonEnd + 1));
            pm2Cache.set(ownerEnv.username, { ts: Date.now(), list: liveJlist });
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  const processes = [];
  const seenNames = new Set();

  if (Array.isArray(liveJlist)) {
    for (const item of liveJlist) {
      const env = item.pm2_env || {};
      const name = item.name || env.name || `pm2-${item.pm_id}`;
      const ns = env.namespace || 'default';
      seenNames.add(`${ns}:${name}`);

      const pid = Number(item.pid) || 0;
      const pr = pid ? procByPid.get(pid) : null;
      const cpu = Number(item.monit?.cpu ?? pr?.cpu ?? 0);
      const memory = Number(item.monit?.memory ?? pr?.mem ?? 0);
      const status = env.status || (pid > 0 ? 'online' : 'stopped');
      const uptimeMs =
        status === 'online' && env.pm_uptime ? Math.max(0, Date.now() - Number(env.pm_uptime)) : 0;

      const rawMode = String(env.exec_mode || 'fork');
      const mode = rawMode.includes('cluster') ? 'cluster' : 'fork';

      processes.push({
        uidKey: `pm2:${ownerEnv.username}:${item.pm_id}:${name}`,
        engine: 'pm2',
        owner: ownerEnv.username,
        ownerUid: ownerEnv.uid,
        id: item.pm_id ?? processes.length,
        name,
        namespace: ns,
        mode,
        instances: Number(env.instances) || 1,
        pids: pid ? [pid] : [],
        pid,
        ports: env.PORT ? [Number(env.PORT)].filter(Boolean) : [],
        status,
        restarts: Number(env.restart_time) || 0,
        unstableRestarts: Number(env.unstable_restarts) || 0,
        exitCode: env.exit_code ?? null,
        uptimeMs,
        cpu: Number(cpu.toFixed(1)),
        memory,
        maxMemoryRestart: env.max_memory_restart || null,
        watch: Boolean(env.watch),
        cron: env.cron_restart || null,
        autorestart: env.autorestart !== false,
        script: env.pm_exec_path || '',
        cwd: env.pm_cwd || '',
        args: Array.isArray(env.args) ? env.args : [],
        outLog: env.pm_out_log_path || path.join(pm2Home, 'logs', `${name}-out.log`),
        errLog: env.pm_err_log_path || path.join(pm2Home, 'logs', `${name}-error.log`),
        nodeVersion: env.node_version || null,
        savedOnly: false,
      });
    }
  }

  savedApps.forEach((app, idx) => {
    const name = app.name || `pm2-app-${idx}`;
    const ns = app.namespace || 'default';
    if (seenNames.has(`${ns}:${name}`)) return;

    const rawMode = String(app.exec_mode || 'fork');
    const mode = rawMode.includes('cluster') ? 'cluster' : 'fork';

    processes.push({
      uidKey: `pm2:${ownerEnv.username}:saved:${name}:${idx}`,
      engine: 'pm2',
      owner: ownerEnv.username,
      ownerUid: ownerEnv.uid,
      id: idx,
      name,
      namespace: ns,
      mode,
      instances: Number(app.instances) || 1,
      pids: [],
      pid: 0,
      ports: app.env?.PORT ? [Number(app.env.PORT)].filter(Boolean) : [],
      status: 'saved',
      restarts: Number(app.restart_time) || 0,
      unstableRestarts: 0,
      exitCode: null,
      uptimeMs: 0,
      cpu: 0,
      memory: 0,
      maxMemoryRestart: app.max_memory_restart || null,
      watch: Boolean(app.watch),
      cron: app.cron_restart || null,
      autorestart: app.autorestart !== false,
      script: app.pm_exec_path || '',
      cwd: app.pm_cwd || '',
      args: Array.isArray(app.args) ? app.args : [],
      outLog: app.pm_out_log_path || path.join(pm2Home, 'logs', `${name}-out.log`),
      errLog: app.pm_err_log_path || path.join(pm2Home, 'logs', `${name}-error.log`),
      nodeVersion: app.node_version || null,
      savedOnly: true,
    });
  });

  return {
    daemon: {
      engine: 'pm2',
      owner: ownerEnv.username,
      ownerUid: ownerEnv.uid,
      stateDir: pm2Home,
      running: Boolean(daemonPid),
      pid: daemonPid,
      version: null,
      onlineCount: processes.filter((p) => p.status === 'online').length,
      totalCount: processes.length,
      savedCount: savedApps.length,
      binPath: ownerEnv.pm2Bin,
    },
    processes,
  };
}

/* ------------------------ Overview Multi-Usuário --------------------------- */

export async function getProcManagersOverview() {
  const [{ byUsername, anyProcmanBin, anyPm2Bin, anyNodeBin }, sudo] = await Promise.all([
    Promise.resolve(discoverUserEnvironments()),
    getSudoStatus(),
  ]);

  const canSudo = Boolean(sudo?.canSudo || getSavedSudoMeta());
  const procSnap = getProcesses();
  const procByPid = new Map();
  for (const p of procSnap.processes || []) {
    procByPid.set(p.pid, p);
  }

  const daemons = [];
  const processes = [];

  for (const ownerEnv of byUsername.values()) {
    const restrictedData = await probeRestrictedHome(ownerEnv, canSudo);
    const [pRes, pm2Res] = await Promise.all([
      inspectUserProcman(ownerEnv, procByPid, restrictedData, canSudo),
      inspectUserPm2(ownerEnv, procByPid, restrictedData, canSudo),
    ]);
    if (pRes) {
      daemons.push(pRes.daemon);
      processes.push(...pRes.processes);
    }
    if (pm2Res) {
      daemons.push(pm2Res.daemon);
      processes.push(...pm2Res.processes);
    }
  }

  const statusRank = { online: 0, launching: 1, errored: 2, stopped: 3, saved: 4 };
  processes.sort(
    (a, b) =>
      (statusRank[a.status] ?? 5) - (statusRank[b.status] ?? 5) ||
      a.engine.localeCompare(b.engine) ||
      a.owner.localeCompare(b.owner) ||
      Number(a.id) - Number(b.id)
  );

  const usersList = Array.from(byUsername.values()).map((u) => ({
    username: u.username,
    uid: u.uid,
    home: u.home,
    hasNode: Boolean(u.nodeBin),
    nodeBin: u.nodeBin,
    procmanBin: u.procmanBin,
    pm2Bin: u.pm2Bin,
  }));

  return {
    ts: Date.now(),
    runtimes: {
      procmanInstalled: Boolean(anyProcmanBin),
      procmanBin: anyProcmanBin,
      pm2Installed: Boolean(anyPm2Bin),
      pm2Bin: anyPm2Bin,
      nodeBin: anyNodeBin,
      users: usersList,
    },
    sudo,
    daemons,
    processes,
  };
}

/* ------------------------ Execução de Ações (procman & PM2) ---------------- */

export async function runProcManagerAction(input, actor = {}) {
  const engine = String(input?.engine || '').toLowerCase();
  const owner = String(input?.owner || '').trim();
  const action = String(input?.action || '').toLowerCase();
  const target = input?.target != null ? String(input.target).trim() : '';
  const instances = input?.instances != null ? Number(input.instances) : null;

  if (engine !== 'procman' && engine !== 'pm2') {
    throw new Error('Engine inválida. Use "procman" ou "pm2".');
  }

  const { byUsername } = discoverUserEnvironments();
  const ownerEnv = byUsername.get(owner);
  if (!ownerEnv) {
    throw new Error(`Usuário do sistema "${owner}" não encontrado.`);
  }

  const allowedActions = new Set([
    'restart',
    'reload',
    'stop',
    'delete',
    'scale',
    'save',
    'resurrect',
    'kill-daemon',
  ]);
  if (!allowedActions.has(action)) {
    throw new Error(`Ação inválida: ${action}`);
  }

  const start = Date.now();
  let output = '';

  if (engine === 'procman') {
    const sockFile = hostPath(path.join(ownerEnv.procmanHome, 'daemon.sock'));
    let handledViaSocket = false;

    if (existsSync(sockFile) && action !== 'resurrect') {
      try {
        if (action === 'save') {
          const r = await callProcmanSocket(sockFile, 'save', {});
          output = `Lista salva em ${r?.file || 'dump.json'} (${r?.apps ?? 0} apps).`;
          handledViaSocket = true;
        } else if (action === 'kill-daemon') {
          await callProcmanSocket(sockFile, 'killMe', {});
          output = `Daemon procman de ${owner} encerrado.`;
          handledViaSocket = true;
        } else if (action === 'scale') {
          if (!target || instances == null || !Number.isInteger(instances) || instances < 0) {
            throw new Error('Informe o alvo e a quantidade de instâncias para escalar.');
          }
          await callProcmanSocket(sockFile, 'scale', { target, instances });
          output = `App "${target}" escalado para ${instances} instância(s).`;
          handledViaSocket = true;
        } else {
          if (!target) throw new Error('Informe o processo alvo.');
          await callProcmanSocket(sockFile, action, { target });
          output = `Ação "${action}" aplicada a "${target}" (procman · ${owner}).`;
          handledViaSocket = true;
        }
      } catch (sockErr) {
        if (
          sockErr.code !== 'EACCES' &&
          sockErr.code !== 'EPERM' &&
          sockErr.code !== 'ENOENT' &&
          sockErr.code !== 'ECONNREFUSED'
        ) {
          throw sockErr;
        }
      }
    }

    if (!handledViaSocket) {
      if (!ownerEnv.procmanBin) {
        throw new Error('Binário do procman (procmand) não encontrado neste host.');
      }
      const cliBase = `${shQuote(ownerEnv.nodeBin || 'node')} ${shQuote(ownerEnv.procmanBin)}`;
      let cliCmd;
      if (action === 'save') cliCmd = `${cliBase} save`;
      else if (action === 'resurrect') cliCmd = `${cliBase} resurrect`;
      else if (action === 'kill-daemon') cliCmd = `${cliBase} kill`;
      else if (action === 'scale') cliCmd = `${cliBase} scale ${shQuote(target)} ${Number(instances) || 1}`;
      else cliCmd = `${cliBase} ${action} ${shQuote(target)}`;

      const r = await execAsHostOwner(ownerEnv, cliCmd, { timeout: 25000 });
      restrictedHomeCache.delete(owner);
      if (r.error === 'requires_sudo_password') {
        throw new Error('Configure a senha no Cofre Sudo para gerenciar processos de outros usuários do sistema.');
      }
      if (r.code !== 0) {
        throw new Error((r.stderr || r.stdout || r.error || 'Erro ao executar procman').trim());
      }
      output = (r.stdout || r.stderr || `Ação ${action} executada com sucesso.`).trim();
    }
  } else {
    if (!ownerEnv.pm2Bin) {
      throw new Error(`Binário do PM2 não encontrado para o usuário "${owner}".`);
    }
    const cliBase = `${shQuote(ownerEnv.nodeBin || 'node')} ${shQuote(ownerEnv.pm2Bin)}`;
    let cliCmd;
    if (action === 'save') cliCmd = `${cliBase} save`;
    else if (action === 'resurrect') cliCmd = `${cliBase} resurrect`;
    else if (action === 'kill-daemon') cliCmd = `${cliBase} kill`;
    else if (action === 'scale') cliCmd = `${cliBase} scale ${shQuote(target)} ${Number(instances) || 1}`;
    else cliCmd = `${cliBase} ${action} ${shQuote(target)}`;

    const r = await execAsHostOwner(ownerEnv, cliCmd, { timeout: 25000 });
    pm2Cache.delete(owner);
    restrictedHomeCache.delete(owner);
    if (r.error === 'requires_sudo_password') {
      throw new Error('Configure a senha no Cofre Sudo para gerenciar processos PM2 de outros usuários.');
    }
    if (r.code !== 0) {
      throw new Error((r.stderr || r.stdout || r.error || 'Erro ao executar PM2').trim());
    }
    output = (r.stdout || r.stderr || `Ação ${action} executada no PM2.`).trim();
  }

  recordSshAudit({
    ...actor,
    action: `${engine}.${action}`,
    detail: `[${engine}@${owner}] ${action}${target ? ` ${target}` : ''}`,
    status: 'ok',
    durationMs: Date.now() - start,
    outputPreview: output.slice(0, 500),
  });

  return {
    ok: true,
    output,
    overview: await getProcManagersOverview(),
  };
}

/* ------------------------ Iniciar Novo Processo / Ecosystem ---------------- */

export async function startProcManagerApp(input, actor = {}) {
  const engine = String(input?.engine || 'procman').toLowerCase();
  const owner = String(input?.owner || '').trim();
  const script = String(input?.script || '').trim();
  const name = String(input?.name || '').trim();
  const namespace = String(input?.namespace || '').trim();
  const cwd = String(input?.cwd || '').trim();
  const mode = String(input?.mode || 'fork').toLowerCase();
  const instances =
    input?.instances != null && String(input.instances).trim() !== ''
      ? String(input.instances).trim()
      : '';
  const maxMemoryRestart = String(input?.maxMemoryRestart || '').trim();
  const cron = String(input?.cron || '').trim();
  const watch = Boolean(input?.watch);
  const extraArgs = String(input?.args || '').trim();

  if (!script) {
    throw new Error('Informe o caminho do script ou arquivo ecosystem.config.js.');
  }

  const { byUsername } = discoverUserEnvironments();
  const ownerEnv = byUsername.get(owner);
  if (!ownerEnv) {
    throw new Error(`Usuário do sistema "${owner}" não encontrado.`);
  }

  let cliCmd = '';
  if (engine === 'procman') {
    if (!ownerEnv.procmanBin) {
      throw new Error('O procman (procmand) ainda não está instalado neste host.');
    }
    const flags = [];
    if (name) flags.push('--name', shQuote(name));
    if (namespace) flags.push('--namespace', shQuote(namespace));
    if (cwd) flags.push('--cwd', shQuote(cwd));
    if (mode === 'cluster') flags.push('--mode', 'cluster');
    if (instances) flags.push('-i', shQuote(instances));
    if (watch) flags.push('--watch');
    if (maxMemoryRestart) flags.push('--max-memory-restart', shQuote(maxMemoryRestart));
    if (cron) flags.push('--cron', shQuote(cron));
    if (extraArgs) flags.push('--', extraArgs);

    cliCmd = `${shQuote(ownerEnv.nodeBin || 'node')} ${shQuote(ownerEnv.procmanBin)} start ${shQuote(script)} ${flags.join(' ')}`;
  } else {
    if (!ownerEnv.pm2Bin) {
      throw new Error('O PM2 não foi encontrado neste host.');
    }
    const flags = [];
    if (name) flags.push('--name', shQuote(name));
    if (namespace) flags.push('--namespace', shQuote(namespace));
    if (cwd) flags.push('--cwd', shQuote(cwd));
    if (mode === 'cluster' || instances) {
      flags.push('-i', shQuote(instances || 'max'));
    }
    if (watch) flags.push('--watch');
    if (maxMemoryRestart) flags.push('--max-memory-restart', shQuote(maxMemoryRestart));
    if (cron) flags.push('--cron-restart', shQuote(cron));
    if (extraArgs) flags.push('--', extraArgs);

    cliCmd = `${shQuote(ownerEnv.nodeBin || 'node')} ${shQuote(ownerEnv.pm2Bin)} start ${shQuote(script)} ${flags.join(' ')}`;
  }

  const start = Date.now();
  const r = await execAsHostOwner(ownerEnv, cliCmd, { timeout: 30000 });
  pm2Cache.delete(owner);
  restrictedHomeCache.delete(owner);

  if (r.error === 'requires_sudo_password') {
    throw new Error('Configure a senha no Cofre Sudo para iniciar processos em nome deste usuário.');
  }
  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout || r.error || `Falha ao iniciar processo no ${engine}`).trim());
  }

  const output = (r.stdout || r.stderr || 'Processo iniciado com sucesso.').trim();
  recordSshAudit({
    ...actor,
    action: `${engine}.start`,
    detail: `[${engine}@${owner}] start ${script}${name ? ` (${name})` : ''}`,
    status: 'ok',
    durationMs: Date.now() - start,
    outputPreview: output.slice(0, 500),
  });

  return {
    ok: true,
    output,
    overview: await getProcManagersOverview(),
  };
}

/* ------------------------ Leitura de Logs por Processo --------------------- */

export async function getProcManagerLogs({
  engine = 'procman',
  owner = '',
  outLog = '',
  errLog = '',
  lines = 120,
} = {}) {
  const maxLines = Math.min(500, Math.max(10, Number(lines) || 120));

  async function readTailHost(filePath) {
    if (!filePath) return [];
    const real = hostPath(filePath);
    if (existsSync(real)) {
      const txt = safeReadFile(real, 512 * 1024);
      if (txt) {
        const all = txt.split('\n');
        if (all[all.length - 1] === '') all.pop();
        return all.slice(-maxLines);
      }
    }
    const r = await execHostSudo(`tail -n ${maxLines} ${shQuote(filePath)} 2>/dev/null || true`, {
      timeout: 6000,
    });
    if (r.code === 0 && r.stdout) {
      const all = r.stdout.split('\n');
      if (all[all.length - 1] === '') all.pop();
      return all;
    }
    return [];
  }

  const [outLines, errLines] = await Promise.all([readTailHost(outLog), readTailHost(errLog)]);

  return {
    engine,
    owner,
    outLog,
    errLog,
    outLines,
    errLines,
  };
}

/* ------------------------ Instalação 1-Click do procmand ------------------- */

export async function installProcmandGlobal(input, actor = {}) {
  const { byUsername, anyNodeBin } = discoverUserEnvironments();
  const owner = String(input?.owner || '').trim();
  const ownerEnv = byUsername.get(owner) || Array.from(byUsername.values())[0];

  const nodeBin = ownerEnv?.nodeBin || anyNodeBin || 'node';
  const npmBin = nodeBin !== 'node' ? path.join(path.dirname(nodeBin), 'npm') : 'npm';

  const start = Date.now();
  const cmd = `${shQuote(npmBin)} install -g procmand`;
  const r = ownerEnv
    ? await execAsHostOwner(ownerEnv, cmd, { timeout: 90000 })
    : await execHostSudo(cmd, { timeout: 90000 });

  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout || r.error || 'Falha ao instalar procmand via npm').trim());
  }

  recordSshAudit({
    ...actor,
    action: 'procman.install',
    detail: `Pacote npm "procmand" instalado globalmente (${npmBin})`,
    status: 'ok',
    durationMs: Date.now() - start,
  });

  return {
    ok: true,
    output: (r.stdout || r.stderr || 'procmand instalado com sucesso!').trim(),
    overview: await getProcManagersOverview(),
  };
}
