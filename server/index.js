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
import { initDb, listClusters, findClusterByName, getClusterRaw, createCluster, updateCluster, deleteCluster, listServersRaw, getServerRaw, createServer as insertServer, updateServer, deleteServer, publicServer } from './db.js';
import { encryptSecret } from './secrets.js';
import { saveLogo, removeLogo, logoFile } from './logos.js';
import * as ssh from './ssh.js';
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
    let tooLarge = false;
    req.on('data', (c) => {
      // após estourar o limite, para de acumular (o restante é descartado)
      if (tooLarge) return;
      data += c;
      if (data.length > limit) {
        tooLarge = true;
        data = '';
        reject(auth.httpError(413, 'corpo da requisição muito grande'));
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 1e6) {
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json')) throw auth.httpError(415, 'envie Content-Type: application/json');
  const raw = await readBody(req, limit);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw auth.httpError(400, 'JSON inválido');
  }
}

const LOGO_LIMIT = 2_500_000;

function applyLogo(value, current) {
  if (value === undefined) return current ?? null;
  if (value === null || value === '') {
    removeLogo(current);
    return null;
  }
  let name;
  try {
    name = saveLogo(value);
  } catch (e) {
    throw auth.httpError(400, e.message);
  }
  if (name !== current) removeLogo(current);
  return name;
}

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  let full = path.join(DIST, rel);
  if (!full.startsWith(DIST + path.sep)) {
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

function sshTarget(row) {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    secretEnc: row.secret_enc,
  };
}

function clusterIdOrNull(value) {
  if (value == null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || !listClusters().some((c) => c.id === id)) throw auth.httpError(400, 'cluster inválido');
  return id;
}

async function sshOverview() {
  const raws = listServersRaw();
  const snaps = await ssh.collectAll(raws.map(sshTarget));
  const byId = new Map(snaps.map((s) => [s.id, s]));

  const clusters = listClusters().map((c) => ({ id: c.id, name: c.name, logo: c.logo ?? null, servers: [] }));
  const byCluster = new Map(clusters.map((c) => [c.id, c]));
  const ungrouped = { id: null, name: 'Sem cluster', logo: null, servers: [] };

  for (const row of raws) {
    const server = { ...publicServer(row), metrics: byId.get(row.id) ?? null };
    const bucket = row.cluster_id != null ? byCluster.get(row.cluster_id) : ungrouped;
    (bucket ?? ungrouped).servers.push(server);
  }
  if (ungrouped.servers.length) clusters.push(ungrouped);
  return { ts: Date.now(), clusters };
}

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

    if (p === '/api/ssh/overview') return json(res, 200, await sshOverview());
    if (p === '/api/ssh/config') return json(res, 200, ssh.readSshConfig());

    if (p.startsWith('/api/ssh/logo/') && req.method === 'GET') {
      const name = decodeURIComponent(p.slice('/api/ssh/logo/'.length));
      const f = logoFile(name);
      if (!f) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
      return createReadStream(f.full).pipe(res);
    }

    if (p === '/api/ssh/clusters' && req.method === 'POST') {
      const body = await readJson(req, LOGO_LIMIT);
      const name = String(body.name ?? '').trim();
      if (name.length < 1 || name.length > 60) return json(res, 400, { error: 'o nome do cluster precisa ter de 1 a 60 caracteres' });
      if (findClusterByName(name)) return json(res, 409, { error: 'já existe um cluster com esse nome' });
      const logo = applyLogo(body.logo, null);
      return json(res, 201, { ok: true, cluster: createCluster(name, logo) });
    }

    if (p === '/api/ssh/clusters/update' && req.method === 'POST') {
      const body = await readJson(req, LOGO_LIMIT);
      const id = Number(body.id);
      const current = getClusterRaw(id);
      if (!current) return json(res, 404, { error: 'cluster não encontrado' });
      let name = current.name;
      if (body.name !== undefined) {
        name = String(body.name).trim();
        if (name.length < 1 || name.length > 60) return json(res, 400, { error: 'o nome do cluster precisa ter de 1 a 60 caracteres' });
        const dup = findClusterByName(name);
        if (dup && dup.id !== id) return json(res, 409, { error: 'já existe um cluster com esse nome' });
      }
      const logo = applyLogo(body.logo, current.logo);
      return json(res, 200, { ok: true, cluster: updateCluster(id, { name, logo }) });
    }

    if (p === '/api/ssh/clusters/delete' && req.method === 'POST') {
      const body = await readJson(req);
      const id = Number(body.id);
      const current = getClusterRaw(id);
      const changed = deleteCluster(id);
      if (changed) removeLogo(current?.logo);
      return json(res, changed ? 200 : 404, changed ? { ok: true } : { error: 'cluster não encontrado' });
    }

    if (p === '/api/ssh/servers' && req.method === 'POST') {
      const body = await readJson(req, LOGO_LIMIT);
      const v = ssh.validateServer(body, { requireSecret: true });
      if (v.error) return json(res, 400, { error: v.error });
      const clusterId = clusterIdOrNull(body.clusterId);
      const secretEnc = v.value.authType === 'system' ? null : encryptSecret(v.value.secret);
      const logo = applyLogo(body.logo, null);
      const created = insertServer({ ...v.value, clusterId, secretEnc, logo });
      return json(res, 201, { ok: true, server: created });
    }

    if (p === '/api/ssh/servers/update' && req.method === 'POST') {
      const body = await readJson(req, LOGO_LIMIT);
      const current = getServerRaw(Number(body.id));
      if (!current) return json(res, 404, { error: 'servidor não encontrado' });
      const authType = body.authType === 'password' ? 'password' : body.authType === 'system' ? 'system' : 'key';
      const hasNewSecret = body.secret != null && String(body.secret).trim() !== '';
      const needsSecret = authType !== 'system' && (!current.secret_enc || authType !== current.auth_type);
      const v = ssh.validateServer(body, { requireSecret: needsSecret && !hasNewSecret });
      if (v.error) return json(res, 400, { error: v.error });
      const clusterId = clusterIdOrNull(body.clusterId);
      let secretEnc;
      if (authType === 'system') secretEnc = null;
      else if (hasNewSecret) secretEnc = encryptSecret(v.value.secret);
      else secretEnc = undefined;
      const logo = applyLogo(body.logo, current.logo);
      ssh.invalidateServer(current.id);
      const updated = updateServer(current.id, { ...v.value, clusterId, secretEnc, logo });
      return json(res, 200, { ok: true, server: updated });
    }

    if (p === '/api/ssh/servers/delete' && req.method === 'POST') {
      const body = await readJson(req);
      const id = Number(body.id);
      const current = getServerRaw(id);
      ssh.invalidateServer(id);
      const changed = deleteServer(id);
      if (changed) removeLogo(current?.logo);
      return json(res, changed ? 200 : 404, changed ? { ok: true } : { error: 'servidor não encontrado' });
    }

    if (p === '/api/ssh/servers/test' && req.method === 'POST') {
      const body = await readJson(req);
      const current = getServerRaw(Number(body.id));
      if (!current) return json(res, 404, { error: 'servidor não encontrado' });
      const snap = await ssh.collectServer(sshTarget(current), { force: true });
      return json(res, 200, {
        ok: !!snap.online,
        online: !!snap.online,
        error: snap.error ?? null,
        hostname: snap.hostname ?? null,
        uname: snap.uname ?? null,
        latencyMs: snap.collectMs ?? null,
      });
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
