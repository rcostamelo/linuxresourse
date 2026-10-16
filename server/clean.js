import { execFile } from 'node:child_process';
import { promises as fsp, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const CACHE_DIR = process.env.XDG_CACHE_HOME || path.join(HOME, '.cache');
const TRASH = path.join(HOME, '.local/share/Trash');

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

async function sudoAvailable() {
  if (process.getuid?.() === 0) return true;
  const r = await exec('sudo', ['-n', 'true'], { timeout: 8000 });
  return r.code === 0;
}

function label(cmd, sudo) {
  return (sudo ? 'sudo ' : '') + cmd.join(' ');
}

async function clearDirs(dirs, recreate = false) {
  const out = [];
  for (const d of dirs) {
    const before = await duSize(d);
    try {
      await fsp.rm(d, { recursive: true, force: true });
      if (recreate) await fsp.mkdir(d, { recursive: true });
      out.push({ target: d, ok: true, freed: before });
    } catch (err) {
      out.push({ target: d, ok: false, freed: 0, error: String(err.message || err) });
    }
  }
  return out;
}

export const TASKS = [
  {
    id: 'journal',
    title: 'Logs do systemd (journal)',
    desc: 'Reduz o journal do sistema para no máximo 200 MB.',
    risk: 'low',
    sudo: true,
    cmd: ['journalctl', '--vacuum-size=200M'],
    sizePaths: ['/var/log/journal'],
  },
  {
    id: 'apt',
    title: 'Cache do APT',
    desc: 'Remove os pacotes .deb já instalados de /var/cache/apt/archives.',
    risk: 'low',
    sudo: true,
    cmd: ['apt', 'clean'],
    sizePaths: ['/var/cache/apt/archives'],
  },
  {
    id: 'thumbs',
    title: 'Cache de miniaturas',
    desc: 'Miniaturas de imagens/vídeos. São regeneradas quando necessário.',
    risk: 'low',
    rmPaths: [path.join(CACHE_DIR, 'thumbnails')],
    sizePaths: [path.join(CACHE_DIR, 'thumbnails')],
  },
  {
    id: 'trash',
    title: 'Esvaziar lixeira',
    desc: 'Remove o conteúdo de ~/.local/share/Trash.',
    risk: 'medium',
    rmPaths: [path.join(TRASH, 'files'), path.join(TRASH, 'info')],
    recreate: true,
    sizePaths: [TRASH],
  },
  {
    id: 'npm',
    title: 'Cache do npm',
    desc: 'Limpa o cache do npm (~/.npm).',
    risk: 'low',
    cmd: ['npm', 'cache', 'clean', '--force'],
    sizePaths: [path.join(HOME, '.npm', '_cacache')],
  },
  {
    id: 'docker',
    title: 'Docker: prune de tudo',
    desc: 'Remove imagens, containers, volumes e redes não utilizados. Irreversível.',
    risk: 'high',
    cmd: ['docker', 'system', 'prune', '-a', '-f', '--volumes'],
    sizePaths: ['/var/lib/docker'],
  },
  {
    id: 'swap-orphans',
    title: 'Swapfiles órfãos em /',
    desc: 'Arquivos de swap na raiz que NÃO estão ativos nem constam no /etc/fstab.',
    risk: 'high',
    special: 'swap',
  },
];

async function detectSwapOrphans() {
  const active = new Set();
  const fstab = new Set();

  try {
    const txt = await fsp.readFile('/proc/swaps', 'utf8');
    for (const line of txt.split('\n').slice(1)) {
      const p = line.trim().split(/\s+/)[0];
      if (!p || p === 'Filename') continue;
      if (p.startsWith('/')) {
        active.add(p);
        try {
          active.add(await fsp.realpath(p));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  try {
    const txt = await fsp.readFile('/etc/fstab', 'utf8');
    for (const line of txt.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const parts = t.split(/\s+/);
      if (parts[2] === 'swap' && parts[0].startsWith('/')) {
        fstab.add(parts[0]);
        try {
          fstab.add(await fsp.realpath(parts[0]));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }

  const orphans = [];
  let entries = [];
  try {
    entries = await fsp.readdir('/', { withFileTypes: true });
  } catch {
    /* ignore */
  }
  for (const e of entries) {
    if (!e.isFile() || !/swap/i.test(e.name)) continue;
    const full = '/' + e.name;
    let real = full;
    try {
      real = await fsp.realpath(full);
    } catch {
      /* ignore */
    }
    if (active.has(full) || active.has(real) || fstab.has(full) || fstab.has(real)) continue;
    let size = 0;
    try {
      const st = await fsp.stat(full);
      size = st.blocks ? st.blocks * 512 : st.size;
    } catch {
      /* ignore */
    }
    orphans.push({ path: full, size });
  }
  return orphans;
}

async function measure(task) {
  if (task.special === 'swap') {
    const orphans = await detectSwapOrphans();
    return { size: orphans.reduce((s, o) => s + o.size, 0), extra: { orphans } };
  }
  if (task.sizePaths?.length) {
    let total = 0;
    for (const p of task.sizePaths) total += await duSize(p);
    return { size: total };
  }
  return { size: 0 };
}

export async function listTasks() {
  const canSudo = await sudoAvailable();
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
      command: task.cmd ? label(task.cmd, task.sudo) : null,
      size,
      orphans: extra?.orphans ?? null,
    });
  }
  return { canSudo, isRoot: process.getuid?.() === 0, tasks };
}

export async function runTask(id, opts = {}) {
  const task = TASKS.find((t) => t.id === id);
  if (!task) throw new Error('tarefa desconhecida');

  if (task.special === 'swap') {
    const orphans = await detectSwapOrphans();
    const requested = new Set(opts.paths || orphans.map((o) => o.path));
    const targets = orphans.filter((o) => requested.has(o.path));
    if (targets.length === 0) return { id, command: 'rm swapfiles', results: [], freed: 0 };
    const results = [];
    let freed = 0;
    for (const t of targets) {
      const useSudo = process.getuid?.() !== 0;
      const bin = useSudo ? 'sudo' : 'rm';
      const args = useSudo ? ['-n', 'rm', '-f', '--', t.path] : ['-f', '--', t.path];
      const r = await exec(bin, args);
      const ok = r.code === 0 && !existsSync(t.path);
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
      needsPassword: results.some((r) => /password/i.test(r.error || '')),
    };
  }

  if (task.rmPaths) {
    const results = await clearDirs(task.rmPaths, task.recreate);
    const freed = results.reduce((s, r) => s + (r.freed || 0), 0);
    return {
      id,
      command: `rm -rf -- ${task.rmPaths.join(' ')}`,
      results,
      freed,
      ok: results.every((r) => r.ok),
    };
  }

  const [bin, ...args] = task.cmd;
  const before = task.sizePaths?.length ? (await measure(task)).size : 0;
  const useSudo = task.sudo && process.getuid?.() !== 0;
  const finalBin = useSudo ? 'sudo' : bin;
  const finalArgs = useSudo ? ['-n', bin, ...args] : args;
  const r = await exec(finalBin, finalArgs);
  const after = task.sizePaths?.length ? (await measure(task)).size : 0;
  const freed = Math.max(0, before - after);
  const needsPassword = /password|authentication is required|a terminal is required|no tty|sudo:/i.test(
    r.stderr,
  );
  return {
    id,
    command: label(task.cmd, task.sudo),
    code: r.code,
    stdout: r.stdout.trim(),
    stderr: r.stderr.trim(),
    freed,
    ok: r.code === 0,
    needsPassword,
    error: r.error,
  };
}
