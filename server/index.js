import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { handleScan, fsInfo, listDisks } from './disk.js';
import { startSampler, getProcesses, getMemory, getSystem, getNetworkRates, getHistory, killProcess } from './system.js';
import { listTasks, runTask } from './clean.js';
import {
  listOsUsersOverview,
  createOsUser,
  updateOsUser,
  deleteOsUser,
  saveAndVerifySudo,
  clearSudoCredential,
} from './osUsers.js';
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
import { DIST, PORT, HOST, DB_FILE, WIDGET_TOKEN } from './config.js';
import {
  initDb,
  listClusters,
  findClusterByName,
  getClusterRaw,
  createCluster,
  updateCluster,
  deleteCluster,
  listServersRaw,
  getServerRaw,
  createServer as insertServer,
  updateServer,
  deleteServer,
  publicServer,
  listSshHistory,
  mapRecentSshHistory,
  recordSshAudit,
  listSshAudit,
} from './db.js';
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

  if (p === '/api/auth/users' && req.method === 'GET') {
    const session = auth.sessionFromRequest(req);
    if (!session) return json(res, 401, { error: 'não autenticado' });
    return json(res, 200, auth.panelUsersOverview(session));
  }

  if (p === '/api/auth/users/create' && req.method === 'POST') {
    const session = auth.sessionFromRequest(req);
    if (!session) return json(res, 401, { error: 'não autenticado' });
    const body = await readJson(req);
    return json(res, 201, auth.adminCreatePanelUser(session, body));
  }

  if (p === '/api/auth/users/update' && req.method === 'POST') {
    const session = auth.sessionFromRequest(req);
    if (!session) return json(res, 401, { error: 'não autenticado' });
    const body = await readJson(req);
    return json(res, 200, auth.adminUpdatePanelUser(session, body));
  }

  if (p === '/api/auth/users/delete' && req.method === 'POST') {
    const session = auth.sessionFromRequest(req);
    if (!session) return json(res, 401, { error: 'não autenticado' });
    const body = await readJson(req);
    return json(res, 200, auth.adminDeletePanelUser(session, body));
  }

  if (p === '/api/auth/sessions/revoke' && req.method === 'POST') {
    const session = auth.sessionFromRequest(req);
    if (!session) return json(res, 401, { error: 'não autenticado' });
    const body = await readJson(req);
    return json(res, 200, auth.revokePanelSession(session, body));
  }

  return json(res, 404, { error: 'not found' });
}

const PUBLIC_API = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/logout',
]);

// Widget de desktop: leitura compacta, protegida por token (header X-Widget-Token).
function isWidgetAuthorized(req) {
  const given = Buffer.from(String(req.headers['x-widget-token'] || ''));
  const expected = Buffer.from(WIDGET_TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function widgetMetrics() {
  const sys = getSystem();
  const { rx, tx } = getNetworkRates();
  return getMemory().then((memory) => ({
    ts: Date.now(),
    hostname: sys.hostname,
    cpuModel: sys.cpuModel,
    cpuUsage: sys.cpuUsage,
    ncpu: sys.ncpu,
    loadavg: sys.loadavg,
    uptime: sys.uptime,
    memory: {
      total: memory.total,
      used: memory.used,
      swapTotal: memory.swapTotal,
      swapUsed: memory.swapUsed,
    },
    network: { rx, tx },
    history: getHistory().points.slice(-60).map((pt) => ({ cpu: pt.cpu, mem: pt.mem })),
  }));
}

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

function actorFromRes(res) {
  const u = res.__session?.user;
  return { userId: u?.id ?? null, username: u?.username ?? 'admin' };
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
  const histById = mapRecentSshHistory(raws.map((r) => r.id), 30);

  const clusters = listClusters().map((c) => ({ id: c.id, name: c.name, logo: c.logo ?? null, servers: [] }));
  const byCluster = new Map(clusters.map((c) => [c.id, c]));
  const ungrouped = { id: null, name: 'Sem cluster', logo: null, servers: [] };

  for (const row of raws) {
    const server = {
      ...publicServer(row),
      metrics: byId.get(row.id) ?? null,
      history: histById.get(row.id) ?? [],
    };
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

    if (p === '/api/widget/metrics' && req.method === 'GET') {
      if (!WIDGET_TOKEN) return json(res, 404, { error: 'widget desativado (defina WIDGET_TOKEN)' });
      if (!isWidgetAuthorized(req)) return json(res, 401, { error: 'token do widget inválido' });
      return json(res, 200, await widgetMetrics());
    }

    if (p.startsWith('/api/')) {
      if (!PUBLIC_API.has(p)) {
        const session = auth.sessionFromRequest(req);
        if (!session) return json(res, 401, { error: 'não autenticado' });
        if (req.method === 'POST' && session.user.role === 'viewer') {
          return json(res, 403, { error: 'Conta somente leitura (viewer). Apenas administradores podem executar ações.' });
        }
        res.__session = session;
      }
    }

    if (p === '/api/health') return json(res, 200, { ok: true, uptime: process.uptime() });

    if (p === '/api/scan') return handleScan(req, res, url);

    if (p === '/api/fs') {
      const target = url.searchParams.get('path') || '/';
      return json(res, 200, { path: target, fs: fsInfo(target) });
    }

    if (p === '/api/disks') {
      return json(res, 200, listDisks());
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

    if (p === '/api/os-users' && req.method === 'GET') {
      return json(res, 200, await listOsUsersOverview());
    }

    if (p === '/api/os-users/sudo' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        const sudo = await saveAndVerifySudo(body, actorFromRes(res));
        return json(res, 200, { ok: true, sudo });
      } catch (err) {
        return json(res, 400, { ok: false, error: String(err.message || err) });
      }
    }

    if (p === '/api/os-users/sudo/clear' && req.method === 'POST') {
      const sudo = await clearSudoCredential(actorFromRes(res));
      return json(res, 200, { ok: true, sudo });
    }

    if (p === '/api/os-users/create' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        return json(res, 201, await createOsUser(body, actorFromRes(res)));
      } catch (err) {
        return json(res, 400, { error: String(err.message || err) });
      }
    }

    if (p === '/api/os-users/update' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        return json(res, 200, await updateOsUser(body, actorFromRes(res)));
      } catch (err) {
        return json(res, 400, { error: String(err.message || err) });
      }
    }

    if (p === '/api/os-users/delete' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        return json(res, 200, await deleteOsUser(body, actorFromRes(res)));
      } catch (err) {
        return json(res, 400, { error: String(err.message || err) });
      }
    }

    if (p === '/api/ssh/overview') return json(res, 200, await sshOverview());
    if (p === '/api/ssh/config') return json(res, 200, ssh.readSshConfig());
    if (p === '/api/ssh/runbooks') return json(res, 200, { runbooks: ssh.listRunbooks() });

    if (p === '/api/ssh/audit' && req.method === 'GET') {
      const serverIdParam = url.searchParams.get('serverId');
      const serverId = serverIdParam ? Number(serverIdParam) : null;
      const limit = Number(url.searchParams.get('limit')) || 80;
      return json(res, 200, { items: listSshAudit({ serverId, limit }) });
    }

    if (p === '/api/ssh/server/detail' && req.method === 'GET') {
      const id = Number(url.searchParams.get('id'));
      const limit = Number(url.searchParams.get('limit')) || 120;
      const force = url.searchParams.get('force') === '1';
      const current = getServerRaw(id);
      if (!current) return json(res, 404, { error: 'servidor não encontrado' });
      const snap = await ssh.collectServer(sshTarget(current), { force });
      const history = listSshHistory(current.id, limit);
      const audit = listSshAudit({ serverId: current.id, limit: 40 });
      return json(res, 200, {
        ts: Date.now(),
        server: { ...publicServer(current), metrics: snap, history, audit },
      });
    }

    if (p === '/api/ssh/hostkey/reset' && req.method === 'POST') {
      const body = await readJson(req);
      const current = getServerRaw(Number(body.serverId));
      if (!current) return json(res, 404, { error: 'servidor não encontrado' });
      const actor = actorFromRes(res);
      const { removed } = ssh.resetHostKey(sshTarget(current));
      const snap = await ssh.collectServer(sshTarget(current), { force: true });
      recordSshAudit({
        ...actor,
        serverId: current.id,
        serverName: current.name,
        action: 'hostkey.reset',
        detail: `Chave removida do known_hosts (${removed} entrada(s)) · nova chave: ${snap.hostKey?.fingerprint ?? 'pendente'}`,
        status: snap.online ? 'ok' : 'error',
        durationMs: snap.collectMs ?? null,
        outputPreview: snap.error ?? snap.hostKey?.fingerprint ?? null,
      });
      return json(res, 200, { ok: true, removed, metrics: snap });
    }

    if (p === '/api/ssh/runbooks/exec' && req.method === 'POST') {
      const body = await readJson(req);
      const current = getServerRaw(Number(body.serverId));
      if (!current) return json(res, 404, { error: 'servidor não encontrado' });
      const runbookId = String(body.runbookId || '');
      const rb = ssh.RUNBOOKS.find((x) => x.id === runbookId);
      if (!rb) return json(res, 404, { error: 'comando pré-definido não encontrado' });

      if (rb.risk === 'high' && String(body.confirmName || '').trim() !== current.name) {
        return json(res, 400, { error: `Para executar esta ação crítica, digite exatamente o nome do servidor (${current.name}).` });
      }

      const actor = actorFromRes(res);
      const result = await ssh.execRunbook(sshTarget(current), runbookId);
      recordSshAudit({
        ...actor,
        serverId: current.id,
        serverName: current.name,
        action: `runbook:${rb.id}`,
        detail: `${rb.title} (${rb.commandPreview})`,
        status: result.ok ? 'ok' : 'error',
        durationMs: result.durationMs,
        outputPreview: (result.stdout || result.stderr || result.error || '').trim(),
      });
      return json(res, 200, result);
    }

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
      const created = createCluster(name, logo);
      recordSshAudit({
        ...actorFromRes(res),
        action: 'cluster.create',
        detail: `Cluster "${created.name}" criado`,
      });
      return json(res, 201, { ok: true, cluster: created });
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
      const updated = updateCluster(id, { name, logo });
      recordSshAudit({
        ...actorFromRes(res),
        action: 'cluster.update',
        detail: `Cluster "${updated.name}" atualizado`,
      });
      return json(res, 200, { ok: true, cluster: updated });
    }

    if (p === '/api/ssh/clusters/delete' && req.method === 'POST') {
      const body = await readJson(req);
      const id = Number(body.id);
      const current = getClusterRaw(id);
      const changed = deleteCluster(id);
      if (changed) {
        removeLogo(current?.logo);
        recordSshAudit({
          ...actorFromRes(res),
          action: 'cluster.delete',
          detail: `Cluster "${current?.name ?? id}" removido`,
        });
      }
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
      recordSshAudit({
        ...actorFromRes(res),
        serverId: created.id,
        serverName: created.name,
        action: 'server.create',
        detail: `${created.username ? `${created.username}@` : ''}${created.host}:${created.port} (${created.authType})`,
      });
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
      recordSshAudit({
        ...actorFromRes(res),
        serverId: updated.id,
        serverName: updated.name,
        action: 'server.update',
        detail: `${updated.username ? `${updated.username}@` : ''}${updated.host}:${updated.port} (${updated.authType})`,
      });
      return json(res, 200, { ok: true, server: updated });
    }

    if (p === '/api/ssh/servers/delete' && req.method === 'POST') {
      const body = await readJson(req);
      const id = Number(body.id);
      const current = getServerRaw(id);
      ssh.invalidateServer(id);
      const changed = deleteServer(id);
      if (changed) {
        removeLogo(current?.logo);
        recordSshAudit({
          ...actorFromRes(res),
          serverId: null,
          serverName: current?.name ?? String(id),
          action: 'server.delete',
          detail: `Servidor "${current?.name ?? id}" (${current?.host ?? ''}) removido`,
        });
      }
      return json(res, changed ? 200 : 404, changed ? { ok: true } : { error: 'servidor não encontrado' });
    }

    if (p === '/api/ssh/servers/test' && req.method === 'POST') {
      const body = await readJson(req);
      const current = getServerRaw(Number(body.id));
      if (!current) return json(res, 404, { error: 'servidor não encontrado' });
      const snap = await ssh.collectServer(sshTarget(current), { force: true });
      recordSshAudit({
        ...actorFromRes(res),
        serverId: current.id,
        serverName: current.name,
        action: 'server.test',
        detail: snap.online
          ? `Conectado (${snap.hostname ?? current.host} · ${snap.uname ?? ''})`
          : `Falha (${snap.errorKind ?? 'erro'}): ${snap.error ?? 'sem resposta'}`,
        status: snap.online ? 'ok' : 'error',
        durationMs: snap.collectMs ?? null,
        outputPreview: snap.error ?? snap.uname ?? null,
      });
      return json(res, 200, {
        ok: !!snap.online,
        online: !!snap.online,
        error: snap.error ?? null,
        errorKind: snap.errorKind ?? null,
        errorHint: snap.errorHint ?? null,
        hostKey: snap.hostKey ?? null,
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
