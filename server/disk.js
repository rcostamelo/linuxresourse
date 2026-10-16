import { promises as fsp, readFileSync, readdirSync, statfsSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { DU_BIN, SCAN_ROOT } from './config.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CONCURRENCY = Number(process.env.DU_CONCURRENCY) || 6;
const cache = new Map();

function toLocal(displayPath) {
  if (!SCAN_ROOT) return displayPath;
  return displayPath === '/' ? SCAN_ROOT : SCAN_ROOT + displayPath;
}

function toDisplay(localPath) {
  if (!SCAN_ROOT) return localPath;
  if (localPath === SCAN_ROOT) return '/';
  return localPath.startsWith(SCAN_ROOT) ? localPath.slice(SCAN_ROOT.length) : localPath;
}

export function fsInfo(target) {
  try {
    const s = statfsSync(toLocal(target));
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

function readTrim(file) {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

function unescapeMountPath(raw) {
  return raw.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function parentBlockName(devName) {
  const nvme = devName.match(/^(nvme\d+n\d+)p\d+$/);
  if (nvme) return nvme[1];
  const mmc = devName.match(/^(mmcblk\d+)p\d+$/);
  if (mmc) return mmc[1];
  const sd = devName.match(/^([a-z]+)\d+$/);
  if (sd) return sd[1];
  return devName;
}

const REAL_FS = new Set([
  'ext2',
  'ext3',
  'ext4',
  'xfs',
  'btrfs',
  'zfs',
  'ntfs',
  'ntfs3',
  'fuseblk',
  'vfat',
  'exfat',
  'f2fs',
  'jfs',
  'reiserfs',
]);

export function listDisks() {
  const sysBlockDir = SCAN_ROOT && existsSync(`${SCAN_ROOT}/sys/block`) ? `${SCAN_ROOT}/sys/block` : '/sys/block';
  const physicalMap = new Map();

  try {
    const blockNames = readdirSync(sysBlockDir);
    for (const name of blockNames) {
      if (/^(loop|ram|sr|zram|dm-|md)/.test(name)) continue;
      const bPath = path.join(sysBlockDir, name);
      const sectors = Number(readTrim(path.join(bPath, 'size')) || 0);
      const size = sectors * 512;
      if (size <= 0) continue;

      const model = readTrim(path.join(bPath, 'device/model')) || readTrim(path.join(bPath, 'device/name')) || 'Disco Físico';
      const rota = readTrim(path.join(bPath, 'queue/rotational'));
      const kind = name.startsWith('nvme') ? 'NVMe' : rota === '0' ? 'SSD' : rota === '1' ? 'HDD' : 'Disco';

      const partitions = [];
      try {
        const sub = readdirSync(bPath);
        for (const subName of sub) {
          if (!subName.startsWith(name)) continue;
          const pSectors = Number(readTrim(path.join(bPath, subName, 'size')) || 0);
          const pSize = pSectors * 512;
          // Ignora partições de boot/BIOS minúsculas (< 16 MB) na listagem visual
          if (pSize >= 16 * 1024 * 1024) {
            partitions.push({
              name: subName,
              device: `/dev/${subName}`,
              size: pSize,
            });
          }
        }
      } catch {
        /* ignore */
      }

      physicalMap.set(name, {
        name,
        device: `/dev/${name}`,
        model,
        kind,
        size,
        partitions: partitions.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
  } catch {
    /* ignore */
  }

  const mountCandidates = [
    SCAN_ROOT ? `${SCAN_ROOT}/proc/1/mounts` : null,
    '/proc/1/mounts',
    SCAN_ROOT ? `${SCAN_ROOT}/proc/mounts` : null,
    '/proc/mounts',
  ].filter(Boolean);

  let mountsRaw = '';
  for (const mf of mountCandidates) {
    if (existsSync(mf)) {
      mountsRaw = readTrim(mf);
      if (mountsRaw) break;
    }
  }

  const byDevice = new Map();
  for (const line of mountsRaw.split('\n')) {
    if (!line) continue;
    const parts = line.split(' ');
    if (parts.length < 3) continue;
    const dev = parts[0];
    let mp = unescapeMountPath(parts[1]);
    const fstype = parts[2];

    if (!dev.startsWith('/dev/')) continue;
    const shortDev = dev.replace(/^\/dev\//, '');
    if (/^(loop|ram|sr|zram)/.test(shortDev)) continue;
    if (!REAL_FS.has(fstype)) continue;

    // Se por acaso estamos lendo a tabela de mounts do próprio container e SCAN_ROOT está montado em /host
    if (SCAN_ROOT && mp === SCAN_ROOT) mp = '/';
    else if (SCAN_ROOT && mp.startsWith(SCAN_ROOT + '/')) mp = mp.slice(SCAN_ROOT.length);

    if (
      mp.startsWith('/snap/') ||
      mp.startsWith('/proc') ||
      mp.startsWith('/sys') ||
      mp.startsWith('/dev') ||
      mp.startsWith('/run/docker') ||
      mp.startsWith('/var/lib/docker/') ||
      mp === '/etc/resolv.conf' ||
      mp === '/etc/hostname' ||
      mp === '/etc/hosts'
    ) {
      continue;
    }

    const existing = byDevice.get(dev);
    if (!existing || mp.length < existing.mount.length) {
      byDevice.set(dev, { device: dev, shortDev, mount: mp, fstype });
    }
  }

  const mounts = [];
  const mountedShortDevs = new Set();

  for (const m of byDevice.values()) {
    const info = fsInfo(m.mount);
    if (!info || info.total <= 0) continue;

    const diskName = parentBlockName(m.shortDev);
    const phys = physicalMap.get(diskName);
    const usedPct = info.total > 0 ? (info.used / info.total) * 100 : 0;
    const label = m.mount === '/' ? 'Sistema Raiz (/)' : path.basename(m.mount) || m.mount;

    mountedShortDevs.add(m.shortDev);
    mounts.push({
      device: m.device,
      name: m.shortDev,
      diskName,
      model: phys?.model || 'Volume Linux',
      kind: phys?.kind || 'Disco',
      fstype: m.fstype,
      mount: m.mount,
      label,
      total: info.total,
      used: info.used,
      free: info.free,
      usedPct,
      mounted: true,
    });
  }

  // Fallback caso esteja num container isolado sem /dev visível em mounts
  if (mounts.length === 0) {
    const rootFs = fsInfo('/');
    if (rootFs && rootFs.total > 0) {
      mounts.push({
        device: '/dev/root',
        name: 'root',
        diskName: 'root',
        model: 'Volume Principal',
        kind: 'SSD',
        fstype: 'ext4',
        mount: '/',
        label: 'Sistema Raiz (/)',
        total: rootFs.total,
        used: rootFs.used,
        free: rootFs.free,
        usedPct: (rootFs.used / rootFs.total) * 100,
        mounted: true,
      });
    }
  }

  mounts.sort((a, b) => {
    if (a.mount === '/') return -1;
    if (b.mount === '/') return 1;
    return a.mount.localeCompare(b.mount);
  });

  // Constrói lista completa de discos físicos com suas partições (montadas ou não)
  const mountByShort = new Map(mounts.map((m) => [m.name, m]));
  const physicalDisks = [];

  for (const phys of physicalMap.values()) {
    const parts = (phys.partitions.length ? phys.partitions : [{ name: phys.name, device: phys.device, size: phys.size }]).map(
      (p) => {
        const m = mountByShort.get(p.name);
        if (m) {
          return {
            name: p.name,
            device: p.device,
            size: p.size,
            mounted: true,
            mount: m.mount,
            label: m.label,
            fstype: m.fstype,
            total: m.total,
            used: m.used,
            free: m.free,
            usedPct: m.usedPct,
          };
        }
        return {
          name: p.name,
          device: p.device,
          size: p.size,
          mounted: false,
          mount: null,
          label: p.name,
          fstype: null,
          total: p.size,
          used: 0,
          free: p.size,
          usedPct: 0,
        };
      },
    );

    const mountedParts = parts.filter((p) => p.mounted);
    const diskTotal = mountedParts.length ? mountedParts.reduce((s, p) => s + p.total, 0) : phys.size;
    const diskUsed = mountedParts.reduce((s, p) => s + p.used, 0);
    const diskFree = mountedParts.length ? mountedParts.reduce((s, p) => s + p.free, 0) : phys.size;

    physicalDisks.push({
      name: phys.name,
      device: phys.device,
      model: phys.model,
      kind: phys.kind,
      rawSize: phys.size,
      mounted: mountedParts.length > 0,
      total: diskTotal,
      used: diskUsed,
      free: diskFree,
      usedPct: mountedParts.length && diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0,
      partitions: parts,
    });
  }

  const total = mounts.reduce((s, m) => s + m.total, 0);
  const used = mounts.reduce((s, m) => s + m.used, 0);
  const free = mounts.reduce((s, m) => s + m.free, 0);
  const rawPhysicalTotal = physicalDisks.reduce((s, d) => s + d.rawSize, 0) || total;

  return {
    ts: Date.now(),
    summary: {
      total,
      used,
      free,
      usedPct: total > 0 ? (used / total) * 100 : 0,
      mountedCount: mounts.length,
      physicalCount: physicalDisks.length || mounts.length,
      rawPhysicalTotal,
    },
    mounts,
    physicalDisks,
  };
}

function duAllocated(dir, signal) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(DU_BIN, ['-x', '-s', '-B1', '--', dir], { signal });
    } catch {
      return resolve(null);
    }
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', () => {});
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const m = out.match(/^(\d+)/m);
      resolve(m ? Number(m[1]) : null);
    });
  });
}

async function scanChildren(dir, { onCount, onItem, signal }) {
  const dirents = await fsp.readdir(dir, { withFileTypes: true });
  const entries = dirents.map((d) => ({
    name: d.name,
    full: path.join(dir, d.name),
    isDir: d.isDirectory(),
  }));

  onCount(entries.length);
  if (entries.length === 0) return;

  let idx = 0;
  let active = 0;
  let done = 0;

  await new Promise((resolve) => {
    const processEntry = async (e) => {
      try {
        if (e.isDir) {
          const size = await duAllocated(e.full, signal);
          return { name: e.name, path: e.full, isDir: true, size: size ?? 0, denied: size === null };
        }
        const st = await fsp.lstat(e.full);
        const isLink = st.isSymbolicLink();
        const size = isLink ? 0 : st.blocks ? st.blocks * 512 : st.size;
        return { name: e.name, path: e.full, isDir: false, size, isLink };
      } catch {
        return { name: e.name, path: e.full, isDir: e.isDir, size: 0, denied: true };
      }
    };

    const next = () => {
      while (active < MAX_CONCURRENCY && idx < entries.length) {
        const e = entries[idx++];
        active++;
        processEntry(e).then((item) => {
          active--;
          done++;
          if (item) onItem(item);
          if (done === entries.length) resolve();
          else next();
        });
      }
    };

    next();
  });
}

export async function handleScan(req, res, url) {
  const target = url.searchParams.get('path') || '/';
  const local = toLocal(target);
  if (!path.isAbsolute(target) || !path.isAbsolute(local)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('path must be absolute');
  }

  let abs;
  let st;
  try {
    abs = path.resolve(local);
    st = await fsp.stat(abs);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  if (!st.isDirectory()) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('not a directory');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const toPublic = (it) => ({ ...it, path: toDisplay(it.path) });

  const cached = cache.get(abs);
  const fresh = cached && Date.now() - cached.ts < CACHE_TTL_MS;

  send('meta', { path: target, fs: fsInfo(target), cached: !!fresh, concurrency: MAX_CONCURRENCY });

  if (fresh) {
    send('count', { total: cached.items.length });
    for (const it of cached.items) send('item', toPublic(it));
    send('done', { path: target, fromCache: true });
    return res.end();
  }

  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const items = [];
  const t0 = Date.now();
  try {
    await scanChildren(abs, {
      onCount: (n) => send('count', { total: n }),
      onItem: (it) => {
        items.push(it);
        send('item', toPublic(it));
      },
      signal: ac.signal,
    });
    if (!ac.signal.aborted) {
      cache.set(abs, { items, ts: Date.now() });
      send('done', { path: target, fromCache: false, elapsedMs: Date.now() - t0 });
    }
  } catch (err) {
    send('error', { message: String((err && err.message) || err) });
  }
  res.end();
}
