import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { handleScan, fsInfo } from './disk.js';
import { startSampler, getProcesses, getMemory, getSystem, getNetworkRates, getHistory, killProcess } from './system.js';
import { listTasks, runTask } from './clean.js';
import { getInterfaces, getTcpStates, getLatency, getConnections } from './network.js';
import {
  getDockerStatus,
  getContainers,
  getImages,
  getSystemDf,
  getLogs,
  getInspect,
  runAction,
} from './docker.js';
import { DIST, PORT, HOST, DB_FILE } from './config.js';
import { initDb } from './db.js';
import * as auth from './auth.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
};

const json = (res, code, data) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const cookies = auth.drainCookies(res);
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(code, headers);
  res.end(JSON.stringify(data));
};

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(auth.httpError(413, 'corpo da requisição muito grande'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json')) throw auth.httpError(415, 'envie Content-Type: application/json');
  const raw = await readBody(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw auth.httpError(400, 'JSON inválido');
  }
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  let full = path.join(DIST, rel);
  if (!full.startsWith(DIST)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  if (!existsSync(full)) {
    if (existsSync(path.join(DIST, 'index.html'))) full = path.join(DIST, 'index.html');
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Build não encontrado. Rode `npm run dev` (Vite) ou `npm run build`.');
    }
  }
  const stream = createReadStream(full);
  stream.on('error', () => {
    res.writeHead(404);
    res.end('not found');
  });
  stream.on('open', () => {
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': full.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600',
    });
    stream.pipe(res);
  });
}

async function handleAuth(req, res, p, url) {
  if (p === '/api/auth/status') return json(res, 200, auth.status(req));

  if (p === '/api/auth/setup' && req.method === 'POST') {
    const body = await readJson(req);
    const user = auth.setupAdmin(body.username, body.password, req, res);
    return json(res, 201, { ok: true, user });
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    const body = await readJson(req);
    const user = auth.login(body.username, body.password, req, res);
    return json(res, 200, { ok: true, user });
  }

  if (p === '/api/auth/logout' && req.method === 'POST') {
    auth.logout(req, res);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/auth/me') {
    const session = auth.sessionFromRequest(req);
    if (!session) return json(res, 401, { error: 'não autenticado' });
    return json(res, 200, { user: session.user, sessionExpiresAt: session.expiresAt });
  }

  if (p === '/api/auth/password' && req.method === 'POST') {
    const session = auth.sessionFromRequest(req);
    if (!session) return json(res, 401, { error: 'não autenticado' });
    const body = await readJson(req);
    auth.changePassword(session, body.currentPassword, body.newPassword);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: 'not found' });
}

const PUBLIC_API = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/logout',
]);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const p = url.pathname;

  try {
    if (p.startsWith('/api/auth/')) return await handleAuth(req, res, p, url);

    if (p.startsWith('/api/')) {
      if (!PUBLIC_API.has(p)) {
        const session = auth.sessionFromRequest(req);
        if (!session) return json(res, 401, { error: 'não autenticado' });
        res.__session = session;
      }
    }

    if (p === '/api/health') return json(res, 200, { ok: true, uptime: process.uptime() });

    if (p === '/api/scan') return handleScan(req, res, url);

    if (p === '/api/fs') {
      const target = url.searchParams.get('path') || '/';
      return json(res, 200, { path: target, fs: fsInfo(target) });
    }

    if (p === '/api/system') return json(res, 200, getSystem());
    if (p === '/api/processes') return json(res, 200, getProcesses());
    if (p === '/api/memory') return json(res, 200, await getMemory());
    if (p === '/api/history') return json(res, 200, getHistory());

    if (p === '/api/network') {
      const [interfaces, tcp, latency] = await Promise.all([
        getInterfaces(),
        getTcpStates(),
        getLatency(url.searchParams.get('host') || '1.1.1.1'),
      ]);
      return json(res, 200, { ...getNetworkRates(), interfaces, tcp, latency });
    }

    if (p === '/api/connections') {
      const limit = Number(url.searchParams.get('limit')) || 300;
      return json(res, 200, { ...(await getConnections({ limit })), latency: await getLatency() });
    }

    if (p === '/api/metrics') {
      const [memory, interfaces] = await Promise.all([getMemory(), getInterfaces()]);
      return json(res, 200, {
        ts: Date.now(),
        system: getSystem(),
        memory,
        network: { ...getNetworkRates(), interfaces },
      });
    }

    if (p === '/api/kill' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        const r = killProcess(Number(body.pid), body.signal);
        return json(res, 200, { ok: true, ...r });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err.message || err) });
      }
    }

    if (p === '/api/docker/status') return json(res, 200, await getDockerStatus());
    if (p === '/api/docker/containers') return json(res, 200, await getContainers());
    if (p === '/api/docker/images') return json(res, 200, await getImages());
    if (p === '/api/docker/df') return json(res, 200, await getSystemDf());
    if (p === '/api/docker/overview') {
      const [containers, images, df] = await Promise.all([getContainers(), getImages(), getSystemDf()]);
      return json(res, 200, {
        ts: Date.now(),
        available: containers.available,
        error: containers.error,
        version: containers.version,
        counts: containers.counts,
        containers: containers.containers,
        images: images.images,
        df: df.rows,
      });
    }
    if (p === '/api/docker/logs') {
      return json(res, 200, await getLogs(url.searchParams.get('id'), url.searchParams.get('tail')));
    }
    if (p === '/api/docker/inspect') {
      return json(res, 200, await getInspect(url.searchParams.get('id')));
    }
    if (p === '/api/docker/action' && req.method === 'POST') {
      const body = await readJson(req);
      const r = await runAction(String(body.id), String(body.action));
      return json(res, r.ok ? 200 : 400, r);
    }

    if (p === '/api/clean/tasks') return json(res, 200, await listTasks());

    if (p === '/api/clean/run' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        return json(res, 200, await runTask(String(body.id), { paths: body.paths }));
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err.message || err) });
      }
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });

    return serveStatic(req, res, p);
  } catch (err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[erro]', err);
    return json(res, status, { error: String((err && err.message) || err) });
  }
});

initDb();
startSampler();

server.listen(PORT, HOST, () => {
  console.log(`Linux Resource → http://${HOST}:${PORT}`);
  if (auth.isSetupNeeded()) {
    console.log('Primeiro acesso: crie o usuário administrador na tela de configuração.');
  }
  console.log(`Banco de dados: ${DB_FILE}`);
  if (!existsSync(path.join(DIST, 'index.html'))) {
    console.warn('aviso: build não encontrado em dist/ — rode `npm run build`.');
  }
  console.log("Frontend dev (Vite) use 'npm run dev'. Ctrl+C para sair.");
});
