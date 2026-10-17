import { execFile } from 'node:child_process';
import { promises as fsp, existsSync } from 'node:fs';
import path from 'node:path';
import { SCAN_ROOT } from './config.js';
import {
  IS_HOST_MOUNT,
  hostPath,
  detectPrimaryHostUser,
  getSudoStatus,
  execHostSudo,
  execAsHostRegularUser,
} from './osUsers.js';

const HOST_USER = detectPrimaryHostUser();
const USER_HOME_HOST = hostPath(HOST_USER.home);
const CACHE_DIR_HOST = path.join(USER_HOME_HOST, '.cache');
const TRASH_HOST = path.join(USER_HOME_HOST, '.local/share/Trash');

function exec(bin, args, { timeout = 180000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { maxBuffer: 16 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      resolve({
        code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: err ? String(err.message || err) : null,
      });
    });
  });
}

async function duSize(p) {
  if (!existsSync(p)) return 0;
  const r = await exec('du', ['-s', '-B1', '--', p]);
  const m = r.stdout.match(/^(\d+)/m);
  return m ? Number(m[1]) : 0;
}

function parseHumanSizeToBytes(str) {
  const m = String(str || '').trim().match(/^([\d.]+)\s*(B|kB|KB|MB|GB|TB|KiB|MiB|GiB|TiB)?/i);
  if (!m) return 0;
  const val = Number.parseFloat(m[1]);
  if (!Number.isFinite(val)) return 0;
  const unit = (m[2] || 'B').toUpperCase();
  const mult =
    {
      B: 1,
      KB: 1e3,
      KIB: 1024,
      MB: 1e6,
      MIB: 1024 ** 2,
      GB: 1e9,
      GIB: 1024 ** 3,
      TB: 1e12,
      TIB: 1024 ** 4,
    }[unit] || 1;
  return Math.round(val * mult);
}

async function dockerReclaimableBytes() {
  const r = await exec('docker', ['system', 'df', '--format', '{{.Reclaimable}}'], { timeout: 10000 });
  if (r.code !== 0) return 0;
  let total = 0;
  for (const line of r.stdout.split('\n')) {
    total += parseHumanSizeToBytes(line);
  }
  return total;
}

export const TASKS = [
  {
    id: 'journal',
    title: 'Logs do systemd (journal)',
    desc: 'Reduz o journal do sistema para no máximo 200 MB.',
    risk: 'low',
    sudo: true,
    command: 'sudo journalctl --vacuum-size=200M',
    hostShell: 'journalctl --vacuum-size=200M',
    sizePaths: [hostPath('/var/log/journal')],
  },
  {
    id: 'apt',
    title: 'Cache do APT',
    desc: 'Remove os pacotes .deb já instalados de /var/cache/apt/archives.',
    risk: 'low',
    sudo: true,
    command: 'sudo apt clean',
    hostShell: 'apt-get clean || apt clean',
    sizePaths: [hostPath('/var/cache/apt/archives')],
  },
  {
    id: 'thumbs',
    title: 'Cache de miniaturas',
    desc: 'Miniaturas de imagens/vídeos. São regeneradas quando necessário.',
    risk: 'low',
    sudo: false,
    command: 'rm -rf ~/.cache/thumbnails/*',
    hostShell: `rm -rf ${JSON.stringify(path.join(HOST_USER.home, '.cache/thumbnails'))}/*`,
    sizePaths: [path.join(CACHE_DIR_HOST, 'thumbnails')],
  },
  {
    id: 'trash',
    title: 'Esvaziar lixeira',
    desc: 'Remove o conteúdo de ~/.local/share/Trash.',
    risk: 'medium',
    sudo: false,
    command: 'rm -rf ~/.local/share/Trash/files/* ~/.local/share/Trash/info/*',
    hostShell: `rm -rf ${JSON.stringify(path.join(HOST_USER.home, '.local/share/Trash/files'))}/* ${JSON.stringify(path.join(HOST_USER.home, '.local/share/Trash/info'))}/*`,
    sizePaths: [TRASH_HOST],
  },
  {
    id: 'npm',
    title: 'Cache do npm',
    desc: 'Limpa o cache do npm (~/.npm).',
    risk: 'low',
    sudo: false,
    command: 'npm cache clean --force',
    hostShell: `rm -rf ${JSON.stringify(path.join(HOST_USER.home, '.npm/_cacache'))}/*`,
    sizePaths: [path.join(USER_HOME_HOST, '.npm', '_cacache')],
  },
  {
    id: 'docker',
    title: 'Docker: prune de tudo',
    desc: 'Remove imagens, containers, volumes e redes não utilizados. Irreversível.',
    risk: 'high',
    sudo: false,
    command: 'docker system prune -a -f --volumes',
    directCmd: ['docker', 'system', 'prune', '-a', '-f', '--volumes'],
    specialSize: 'docker',
  },
  {
    id: 'swap-orphans',
    title: 'Swapfiles órfãos em /',
    desc: 'Arquivos de swap na raiz que NÃO estão ativos nem constam no /etc/fstab.',
    risk: 'high',
    sudo: true,
    command: 'sudo rm -f /swapfile*',
    special: 'swap',
  },
];

async function detectSwapOrphans() {
  const active = new Set();
  const fstab = new Set();
  const rootDir = IS_HOST_MOUNT ? SCAN_ROOT : '/';

  try {
    const swapsFile = existsSync(hostPath('/proc/swaps')) ? hostPath('/proc/swaps') : '/proc/swaps';
    const txt = await fsp.readFile(swapsFile, 'utf8');
    for (const line of txt.split('\n').slice(1)) {
      const p = line.trim().split(/\s+/)[0];
      if (!p || p === 'Filename') continue;
      if (p.startsWith('/')) active.add(p);
    }
  } catch {
    /* ignore */
  }

  try {
    const txt = await fsp.readFile(hostPath('/etc/fstab'), 'utf8');
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const parts = t.split(/\s+/);
      if (parts[2] === 'swap' && parts[0].startsWith('/')) {
        fstab.add(parts[0]);
      }
    }
  } catch {
    /* ignore */
  }

  const orphans = [];
  let entries = [];
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch {
    /* ignore */
  }
  for (const e of entries) {
    if (!e.isFile() || !/swap/i.test(e.name)) continue;
    const logicalFull = '/' + e.name;
    const actualFull = path.join(rootDir, e.name);
    if (active.has(logicalFull) || fstab.has(logicalFull)) continue;
    let size = 0;
    try {
      const st = await fsp.stat(actualFull);
      size = st.blocks ? st.blocks * 512 : st.size;
    } catch {
      /* ignore */
    }
    orphans.push({ path: logicalFull, size });
  }
  return orphans;
}

async function measure(task) {
  if (task.special === 'swap') {
    const orphans = await detectSwapOrphans();
    return { size: orphans.reduce((s, o) => s + o.size, 0), extra: { orphans } };
  }
  if (task.specialSize === 'docker') {
    return { size: await dockerReclaimableBytes() };
  }
  if (task.sizePaths?.length) {
    let total = 0;
    for (const p of task.sizePaths) total += await duSize(p);
    return { size: total };
  }
  return { size: 0 };
}

export async function listTasks() {
  const sudo = await getSudoStatus();
  const tasks = [];
  for (const task of TASKS) {
    const { size, extra } = await measure(task);
    tasks.push({
      id: task.id,
      title: task.title,
      desc: task.desc,
      risk: task.risk,
      sudo: !!task.sudo,
      special: task.special || null,
      command: task.command || null,
      size,
      orphans: extra?.orphans ?? null,
    });
  }
  return {
    canSudo: sudo.canSudo,
    isRoot: sudo.isRoot,
    sudoUser: sudo.configuredUser,
    sudoMethod: sudo.method,
    tasks,
  };
}

export async function runTask(id, opts = {}) {
  const task = TASKS.find((t) => t.id === id);
  if (!task) throw new Error('tarefa desconhecida');

  if (task.special === 'swap') {
    const orphans = await detectSwapOrphans();
    const requested = new Set(opts.paths || orphans.map((o) => o.path));
    const targets = orphans.filter((o) => requested.has(o.path));
    if (targets.length === 0) return { id, command: 'rm swapfiles', results: [], freed: 0, ok: true };
    const results = [];
    let freed = 0;
    for (const t of targets) {
      const r = await execHostSudo(`rm -f -- ${JSON.stringify(t.path)}`);
      const ok = r.code === 0;
      if (ok) freed += t.size;
      results.push({
        target: t.path,
        ok,
        freed: ok ? t.size : 0,
        error: ok ? null : r.stderr.trim() || r.error,
      });
    }
    return {
      id,
      command: `sudo rm -f -- ${targets.map((t) => t.path).join(' ')}`,
      results,
      freed,
      ok: results.every((r) => r.ok),
      needsPassword: results.some((r) => /password|senha não configurada/i.test(r.error || '')),
    };
  }

  if (task.directCmd) {
    const before = (await measure(task)).size;
    const [bin, ...args] = task.directCmd;
    const r = await exec(bin, args);
    const after = (await measure(task)).size;
    return {
      id,
      command: task.command,
      code: r.code,
      stdout: r.stdout.trim(),
      stderr: r.stderr.trim(),
      freed: Math.max(0, before - after),
      ok: r.code === 0,
      needsPassword: false,
      error: r.error,
    };
  }

  const before = (await measure(task)).size;
  const r = task.sudo
    ? await execHostSudo(task.hostShell)
    : await execAsHostRegularUser(task.hostShell);
  const after = (await measure(task)).size;
  const freed = Math.max(0, before - after);
  const needsPassword = /password|authentication is required|a terminal is required|no tty|sudo:|senha não configurada/i.test(
    r.stderr,
  );
  return {
    id,
    command: task.command,
    code: r.code,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
    freed,
    ok: r.code === 0,
    needsPassword,
    error: r.error,
  };
}
