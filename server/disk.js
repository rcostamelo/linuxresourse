import { promises as fsp, statfsSync } from 'node:fs';
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
