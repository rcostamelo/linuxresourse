import { execFile } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
  unlinkSync,
  symlinkSync,
  copyFileSync,
} from 'node:fs';
import path from 'node:path';
import { IS_HOST_MOUNT, hostPath, execHostSudo, getSudoStatus } from './osUsers.js';
import { getProcesses } from './system.js';
import { recordSshAudit } from './db.js';

function execLocal(bin, args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: err ? String(err.message || err) : null,
      });
    });
  });
}

const VALID_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/;

export function isValidSiteName(name) {
  return typeof name === 'string' && VALID_NAME_RE.test(name) && !name.includes('..');
}

function stripComments(content) {
  return String(content || '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('#');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
}

export function parseNginxConfigMeta(rawContent) {
  const raw = String(rawContent || '');
  const clean = stripComments(raw);

  // Primeiro comentário descritivo no topo do arquivo
  let description = null;
  for (const line of raw.split('\n').slice(0, 8)) {
    const t = line.trim();
    if (t.startsWith('#')) {
      const comment = t.replace(/^#+\s*/, '').trim();
      if (comment && !comment.startsWith('---')) {
        description = comment;
        break;
      }
    } else if (t.length > 0) {
      break;
    }
  }

  const serverNames = new Set();
  const listenPorts = new Set();
  const roots = new Set();
  const rateLimits = new Set();
  const upstreams = [];
  let ssl = false;

  // server_name
  const snRegex = /\bserver_name\s+([^;]+);/g;
  let m;
  while ((m = snRegex.exec(clean)) !== null) {
    const tokens = m[1]
      .trim()
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const tok of tokens) serverNames.add(tok);
  }

  // listen
  const listenRegex = /\blisten\s+([^;]+);/g;
  while ((m = listenRegex.exec(clean)) !== null) {
    const val = m[1].trim().replace(/\s+/g, ' ');
    listenPorts.add(val);
    if (/\bssl\b|\b443\b|\bhttp2\b/i.test(val)) ssl = true;
  }

  if (/\bssl_certificate\b/.test(clean)) ssl = true;

  // root
  const rootRegex = /\broot\s+([^;]+);/g;
  while ((m = rootRegex.exec(clean)) !== null) {
    roots.add(m[1].trim().replace(/^["']|["']$/g, ''));
  }

  // rate limits
  const limitZoneRegex = /\blimit_req_zone\s+([^;]+);/g;
  while ((m = limitZoneRegex.exec(clean)) !== null) {
    rateLimits.add(`zone: ${m[1].trim().replace(/\s+/g, ' ')}`);
  }
  const limitReqRegex = /\blimit_req\s+([^;]+);/g;
  while ((m = limitReqRegex.exec(clean)) !== null) {
    rateLimits.add(m[1].trim().replace(/\s+/g, ' '));
  }

  // location blocks with proxy_pass or root/alias
  const locRegex = /\blocation\s+([^{]+)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  while ((m = locRegex.exec(clean)) !== null) {
    const locPath = m[1].trim().replace(/\s+/g, ' ');
    const body = m[2] || '';
    const ppMatch = body.match(/\bproxy_pass\s+([^;]+);/);
    if (ppMatch) {
      const target = ppMatch[1].trim().replace(/^["']|["']$/g, '');
      const websocket = /Upgrade|\$http_upgrade/i.test(body);
      upstreams.push({
        location: locPath,
        target,
        websocket,
      });
    }
  }

  // Caso haja proxy_pass fora de location (direto em server)
  if (upstreams.length === 0) {
    const ppGlobal = /\bproxy_pass\s+([^;]+);/g;
    while ((m = ppGlobal.exec(clean)) !== null) {
      upstreams.push({
        location: '/',
        target: m[1].trim(),
        websocket: /Upgrade|\$http_upgrade/i.test(clean),
      });
    }
  }

  const serverBlocksCount = (clean.match(/\bserver\s*\{/g) || []).length;

  return {
    description,
    serverBlocksCount,
    serverNames: Array.from(serverNames),
    listenPorts: Array.from(listenPorts),
    ssl,
    upstreams,
    roots: Array.from(roots),
    rateLimits: Array.from(rateLimits),
  };
}

function safeReadFile(fullPath) {
  try {
    return readFileSync(fullPath, 'utf8');
  } catch {
    return '';
  }
}

function resolveRealTargetPath(entryPath, symlinkTarget) {
  if (!symlinkTarget) return entryPath;
  if (symlinkTarget.startsWith('/')) {
    return hostPath(symlinkTarget);
  }
  return path.resolve(path.dirname(entryPath), symlinkTarget);
}

export function listNginxConfigs() {
  const etcNginx = hostPath('/etc/nginx');
  const availDir = hostPath('/etc/nginx/sites-available');
  const enabledDir = hostPath('/etc/nginx/sites-enabled');
  const confdDir = hostPath('/etc/nginx/conf.d');
  const mainConf = hostPath('/etc/nginx/nginx.conf');

  const sitesMap = new Map();

  if (existsSync(availDir)) {
    try {
      for (const name of readdirSync(availDir)) {
        if (name.startsWith('.') || name.endsWith('.dpkg-old') || name.endsWith('.bak')) continue;
        const full = path.join(availDir, name);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        const content = safeReadFile(full);
        sitesMap.set(name, {
          name,
          scope: 'site',
          enabled: false,
          inAvailable: true,
          inEnabled: false,
          isSymlink: false,
          symlinkTarget: null,
          diverged: false,
          path: `/etc/nginx/sites-available/${name}`,
          enabledPath: null,
          size: st.size,
          mtime: st.mtimeMs,
          ...parseNginxConfigMeta(content),
        });
      }
    } catch {
      /* ignore */
    }
  }

  if (existsSync(enabledDir)) {
    try {
      for (const name of readdirSync(enabledDir)) {
        if (name.startsWith('.') || name.endsWith('.dpkg-old') || name.endsWith('.bak')) continue;
        const full = path.join(enabledDir, name);
        let lst;
        try {
          lst = lstatSync(full);
        } catch {
          continue;
        }
        const isSymlink = lst.isSymbolicLink();
        let symlinkTarget = null;
        if (isSymlink) {
          try {
            symlinkTarget = readlinkSync(full);
          } catch {
            symlinkTarget = null;
          }
        }
        const resolvedFull = isSymlink ? resolveRealTargetPath(full, symlinkTarget) : full;
        let st;
        try {
          st = statSync(resolvedFull);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        const content = safeReadFile(resolvedFull);
        const existing = sitesMap.get(name);
        if (existing) {
          const availContent = safeReadFile(path.join(availDir, name));
          existing.enabled = true;
          existing.inEnabled = true;
          existing.isSymlink = isSymlink;
          existing.symlinkTarget = symlinkTarget;
          existing.enabledPath = `/etc/nginx/sites-enabled/${name}`;
          existing.diverged = !isSymlink && availContent !== content;
          if (existing.diverged) {
            Object.assign(existing, parseNginxConfigMeta(content));
            existing.size = st.size;
            existing.mtime = st.mtimeMs;
          }
        } else {
          sitesMap.set(name, {
            name,
            scope: 'site',
            enabled: true,
            inAvailable: false,
            inEnabled: true,
            isSymlink,
            symlinkTarget,
            diverged: false,
            path: `/etc/nginx/sites-enabled/${name}`,
            enabledPath: `/etc/nginx/sites-enabled/${name}`,
            size: st.size,
            mtime: st.mtimeMs,
            ...parseNginxConfigMeta(content),
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  const confdList = [];
  if (existsSync(confdDir)) {
    try {
      for (const name of readdirSync(confdDir)) {
        if (name.startsWith('.') || name.endsWith('.dpkg-old') || name.endsWith('.bak')) continue;
        const full = path.join(confdDir, name);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        const isActiveConf = name.endsWith('.conf');
        const content = safeReadFile(full);
        confdList.push({
          name,
          scope: 'conf.d',
          enabled: isActiveConf,
          inAvailable: true,
          inEnabled: isActiveConf,
          isSymlink: false,
          symlinkTarget: null,
          diverged: false,
          path: `/etc/nginx/conf.d/${name}`,
          enabledPath: isActiveConf ? `/etc/nginx/conf.d/${name}` : null,
          size: st.size,
          mtime: st.mtimeMs,
          ...parseNginxConfigMeta(content),
        });
      }
    } catch {
      /* ignore */
    }
  }

  let mainConfigItem = null;
  if (existsSync(mainConf)) {
    try {
      const st = statSync(mainConf);
      const content = safeReadFile(mainConf);
      mainConfigItem = {
        name: 'nginx.conf',
        scope: 'main',
        enabled: true,
        inAvailable: true,
        inEnabled: true,
        isSymlink: false,
        symlinkTarget: null,
        diverged: false,
        path: '/etc/nginx/nginx.conf',
        enabledPath: '/etc/nginx/nginx.conf',
        size: st.size,
        mtime: st.mtimeMs,
        ...parseNginxConfigMeta(content),
      };
    } catch {
      mainConfigItem = null;
    }
  }

  const sites = Array.from(sitesMap.values()).sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  confdList.sort((a, b) => a.name.localeCompare(b.name));

  return {
    installed: existsSync(etcNginx),
    sites,
    confd: confdList,
    mainConfig: mainConfigItem,
  };
}

let versionCache = { ts: 0, version: null, binFound: false };

async function detectNginxBinary() {
  if (Date.now() - versionCache.ts < 60000 && versionCache.version !== null) {
    return versionCache;
  }
  const binPath = existsSync(hostPath('/usr/sbin/nginx'))
    ? hostPath('/usr/sbin/nginx')
    : existsSync(hostPath('/usr/bin/nginx'))
      ? hostPath('/usr/bin/nginx')
      : null;

  if (!IS_HOST_MOUNT && binPath) {
    const r = await execLocal(binPath, ['-v'], { timeout: 5000 });
    const out = (r.stderr || r.stdout || '').trim();
    const m = out.match(/nginx\/([^\s]+)/i);
    versionCache = {
      ts: Date.now(),
      binFound: true,
      version: m ? m[1] : null,
      rawVersion: out || null,
    };
    return versionCache;
  }

  // Em container com /host montado, extrai a versão diretamente do binário ELF /host/usr/sbin/nginx
  if (binPath) {
    try {
      const buf = readFileSync(binPath);
      const ascii = buf.toString('latin1');
      const m = ascii.match(/nginx\/(\d+\.\d+\.\d+)/);
      versionCache = {
        ts: Date.now(),
        binFound: true,
        version: m ? m[1] : '1.x',
        rawVersion: m ? `nginx/${m[1]}` : null,
      };
      return versionCache;
    } catch {
      /* ignore */
    }
  }

  versionCache = {
    ts: Date.now(),
    binFound: Boolean(binPath),
    version: binPath ? '1.x' : null,
    rawVersion: null,
  };
  return versionCache;
}

function readHostNginxPid() {
  for (const p of ['/run/nginx.pid', '/var/run/nginx.pid']) {
    const full = hostPath(p);
    if (existsSync(full)) {
      const val = Number(safeReadFile(full).trim());
      if (Number.isInteger(val) && val > 0) return val;
    }
  }
  return null;
}

export async function getNginxOverview() {
  const [binInfo, sudo] = await Promise.all([detectNginxBinary(), getSudoStatus()]);
  const configs = listNginxConfigs();

  const procSnap = getProcesses();
  const nginxProcs = (procSnap.processes || []).filter(
    (p) => p.name === 'nginx' || p.cmdline.startsWith('nginx:') || p.cmdline.includes('/nginx')
  );
  const masterProc =
    nginxProcs.find((p) => p.cmdline.includes('master process')) ||
    nginxProcs.sort((a, b) => a.pid - b.pid)[0] ||
    null;
  const pidFromFile = readHostNginxPid();
  const masterPid = masterProc?.pid ?? pidFromFile;
  const workerCount =
    nginxProcs.filter((p) => p.cmdline.includes('worker process')).length ||
    Math.max(0, nginxProcs.length - (masterProc ? 1 : 0));
  const memoryBytes = nginxProcs.reduce((acc, p) => acc + (p.mem || 0), 0);
  const cpuPct = nginxProcs.reduce((acc, p) => acc + (p.cpu || 0), 0);

  let active = nginxProcs.length > 0 || Boolean(pidFromFile && existsSync(`/proc/${pidFromFile}`));
  let subState = active ? 'running' : 'dead';
  let enabledBoot = existsSync(hostPath('/etc/systemd/system/multi-user.target.wants/nginx.service'));

  if (!IS_HOST_MOUNT) {
    const [actRes, enRes] = await Promise.all([
      execLocal('systemctl', ['is-active', 'nginx'], { timeout: 4000 }),
      execLocal('systemctl', ['is-enabled', 'nginx'], { timeout: 4000 }),
    ]);
    const actStr = actRes.stdout.trim();
    if (actStr === 'active') {
      active = true;
      subState = 'running';
    } else if (actStr === 'inactive' || actStr === 'failed') {
      active = nginxProcs.length > 0;
      subState = actStr;
    }
    if (enRes.stdout.trim()) {
      enabledBoot = enRes.stdout.trim() === 'enabled';
    }
  }

  return {
    ts: Date.now(),
    installed: binInfo.binFound || configs.installed,
    version: binInfo.version,
    rawVersion: binInfo.rawVersion,
    service: {
      active,
      subState,
      enabledBoot,
      masterPid,
      uptimeSec: masterProc?.elapsedSec ?? null,
      workerCount,
      processCount: nginxProcs.length,
      memoryBytes,
      cpuPct: Number(cpuPct.toFixed(2)),
    },
    sudo,
    sites: configs.sites,
    confd: configs.confd,
    mainConfig: configs.mainConfig,
  };
}

export async function testNginxConfig() {
  const start = Date.now();
  const sudoRes = await execHostSudo('/usr/sbin/nginx -t', { timeout: 15000 });
  if (sudoRes.error !== 'requires_sudo_password') {
    const out = [sudoRes.stdout, sudoRes.stderr].filter(Boolean).join('\n').trim();
    return {
      ok: sudoRes.code === 0,
      code: sudoRes.code,
      output:
        out ||
        (sudoRes.code === 0
          ? 'nginx: configuration file /etc/nginx/nginx.conf test is successful'
          : 'Falha ao testar configuração'),
      durationMs: Date.now() - start,
      usedSudo: true,
    };
  }

  if (!IS_HOST_MOUNT) {
    const localRes = await execLocal('/usr/sbin/nginx', ['-t'], { timeout: 10000 });
    const out = [localRes.stdout, localRes.stderr].filter(Boolean).join('\n').trim();
    return {
      ok: localRes.code === 0,
      code: localRes.code,
      output: out,
      durationMs: Date.now() - start,
      usedSudo: false,
      needsSudo: localRes.code !== 0 && /permission denied|alert/i.test(out),
    };
  }

  return {
    ok: false,
    code: 1,
    output:
      'Configure a senha sudo no Cofre Sudo para executar `nginx -t` com privilégios de leitura de certificados e sockets.',
    durationMs: Date.now() - start,
    usedSudo: false,
    needsSudo: true,
  };
}

function buildServiceShellCmd(action) {
  if (action === 'reload') {
    return '(systemctl reload nginx 2>/dev/null || /usr/sbin/nginx -s reload) && /usr/sbin/nginx -t';
  }
  if (action === 'stop') {
    return 'systemctl stop nginx 2>/dev/null || /usr/sbin/nginx -s quit';
  }
  if (action === 'start') {
    return '(systemctl start nginx 2>/dev/null || /usr/sbin/nginx) && /usr/sbin/nginx -t';
  }
  // restart
  return '(systemctl restart nginx 2>/dev/null || (/usr/sbin/nginx -s quit 2>/dev/null; sleep 1; /usr/sbin/nginx)) && /usr/sbin/nginx -t';
}

export async function runNginxServiceAction(action, actor = {}) {
  const allowed = new Set(['start', 'stop', 'restart', 'reload']);
  if (!allowed.has(action)) {
    throw new Error(`Ação inválida: ${action}`);
  }

  const start = Date.now();
  if (action === 'reload' || action === 'restart') {
    const check = await testNginxConfig();
    if (!check.ok && !check.needsSudo) {
      return {
        ok: false,
        action,
        output: `Ação abortada porque "nginx -t" reportou erro na configuração:\n\n${check.output}`,
        durationMs: Date.now() - start,
      };
    }
  }

  const cmd = buildServiceShellCmd(action);
  const r = await execHostSudo(cmd, { timeout: 25000 });
  const output = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();

  recordSshAudit({
    ...actor,
    action: `nginx.${action}`,
    detail: `Serviço Nginx: ${action}`,
    status: r.code === 0 ? 'ok' : 'error',
    durationMs: Date.now() - start,
    outputPreview: output || r.error || null,
  });

  if (r.error === 'requires_sudo_password') {
    throw new Error('Credencial sudo não configurada. Abra o Cofre Sudo para autorizar comandos no Nginx.');
  }

  return {
    ok: r.code === 0,
    action,
    output:
      output ||
      (r.code === 0 ? `Ação ${action} executada com sucesso no Nginx.` : r.error || 'Erro ao controlar Nginx'),
    durationMs: Date.now() - start,
    overview: await getNginxOverview(),
  };
}

function resolveConfigTarget(name, scope = 'site') {
  if (scope === 'main') {
    return {
      name: 'nginx.conf',
      scope: 'main',
      virtualPath: '/etc/nginx/nginx.conf',
      realPath: hostPath('/etc/nginx/nginx.conf'),
    };
  }
  if (!isValidSiteName(name)) {
    throw new Error('Nome de arquivo inválido. Use apenas letras, números, ponto, hífen ou sublinhado.');
  }
  if (scope === 'conf.d') {
    const cleanName = name.endsWith('.conf') || name.endsWith('.disabled') ? name : `${name}.conf`;
    return {
      name: cleanName,
      scope: 'conf.d',
      virtualPath: `/etc/nginx/conf.d/${cleanName}`,
      realPath: hostPath(`/etc/nginx/conf.d/${cleanName}`),
    };
  }
  const availPath = hostPath(`/etc/nginx/sites-available/${name}`);
  const enabledPath = hostPath(`/etc/nginx/sites-enabled/${name}`);
  let enabledExists = false;
  let enabledIsSymlink = false;
  try {
    const lst = lstatSync(enabledPath);
    enabledExists = true;
    enabledIsSymlink = lst.isSymbolicLink();
  } catch {
    enabledExists = false;
    enabledIsSymlink = false;
  }
  const preferEnabled = enabledExists && !enabledIsSymlink;
  const targetReal = preferEnabled || !existsSync(availPath) ? (enabledExists ? enabledPath : availPath) : availPath;
  const targetVirtual =
    targetReal === enabledPath ? `/etc/nginx/sites-enabled/${name}` : `/etc/nginx/sites-available/${name}`;

  return {
    name,
    scope: 'site',
    virtualPath: targetVirtual,
    realPath: targetReal,
    availPath,
    enabledPath,
  };
}

export async function readNginxConfigFile(name, scope = 'site') {
  const target = resolveConfigTarget(name, scope);
  if (!existsSync(target.realPath)) {
    throw new Error(`Arquivo não encontrado: ${target.virtualPath}`);
  }
  const content = readFileSync(target.realPath, 'utf8');
  return {
    name: target.name,
    scope: target.scope,
    path: target.virtualPath,
    content,
    meta: parseNginxConfigMeta(content),
  };
}

async function writeHostFile(virtualPath, realPath, content) {
  if (!IS_HOST_MOUNT) {
    try {
      writeFileSync(realPath, content, 'utf8');
      return { ok: true };
    } catch {
      /* fallback via sudo */
    }
  }
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const cmd = `printf '%s' '${b64}' | base64 -d > ${JSON.stringify(virtualPath)}`;
  const r = await execHostSudo(cmd, { timeout: 15000 });
  if (r.code !== 0) {
    throw new Error(r.stderr || r.error || `Sem permissão para gravar ${virtualPath}`);
  }
  return { ok: true };
}

export async function saveNginxConfigFile(
  { name, scope = 'site', content, enable = true, reloadAfter = true },
  actor = {}
) {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('O conteúdo da configuração não pode estar vazio.');
  }

  const target = resolveConfigTarget(name, scope);
  const existed = existsSync(target.realPath);
  const previousContent = existed ? safeReadFile(target.realPath) : null;

  if (scope === 'site') {
    const availVirtual = `/etc/nginx/sites-available/${target.name}`;
    const enabledVirtual = `/etc/nginx/sites-enabled/${target.name}`;
    await writeHostFile(availVirtual, target.availPath, content);

    let enabledExists = false;
    let isSym = false;
    try {
      const lst = lstatSync(target.enabledPath);
      enabledExists = true;
      isSym = lst.isSymbolicLink();
    } catch {
      enabledExists = false;
    }

    if (enabledExists && !isSym) {
      await writeHostFile(enabledVirtual, target.enabledPath, content);
    } else if (!existed && enable) {
      if (!IS_HOST_MOUNT) {
        try {
          symlinkSync(availVirtual, target.enabledPath);
        } catch {
          await execHostSudo(`ln -sfn ${JSON.stringify(availVirtual)} ${JSON.stringify(enabledVirtual)}`);
        }
      } else {
        await execHostSudo(`ln -sfn ${JSON.stringify(availVirtual)} ${JSON.stringify(enabledVirtual)}`);
      }
    }
  } else {
    await writeHostFile(target.virtualPath, target.realPath, content);
  }

  const testResult = await testNginxConfig();
  let reloadResult = null;

  if (reloadAfter && testResult.ok) {
    const r = await execHostSudo(buildServiceShellCmd('reload'), { timeout: 15000 });
    reloadResult = {
      ok: r.code === 0,
      output: (r.stdout || r.stderr || '').trim(),
    };
  }

  recordSshAudit({
    ...actor,
    action: existed ? 'nginx.config.update' : 'nginx.config.create',
    detail: `${existed ? 'Editado' : 'Criado'} ${target.virtualPath}${reloadResult?.ok ? ' (reload aplicado)' : ''}`,
    status: testResult.ok ? 'ok' : 'error',
    outputPreview: testResult.output,
  });

  return {
    ok: true,
    path: target.virtualPath,
    previousExisted: existed,
    previousContent,
    testResult,
    reloadResult,
    overview: await getNginxOverview(),
  };
}

export async function toggleNginxSite({ name, scope = 'site', enabled, reloadAfter = true }, actor = {}) {
  if (scope === 'conf.d') {
    if (!isValidSiteName(name)) throw new Error('Nome de configuração inválido.');
    const baseName = name.replace(/\.(conf|disabled)$/, '');
    const activeVirtual = `/etc/nginx/conf.d/${baseName}.conf`;
    const disabledVirtual = `/etc/nginx/conf.d/${baseName}.disabled`;
    const fromVirtual = enabled ? disabledVirtual : activeVirtual;
    const toVirtual = enabled ? activeVirtual : disabledVirtual;
    const r = await execHostSudo(`mv -f ${JSON.stringify(fromVirtual)} ${JSON.stringify(toVirtual)}`, {
      timeout: 15000,
    });
    if (r.code !== 0) {
      throw new Error(r.stderr || r.error || 'Falha ao alternar arquivo em conf.d');
    }
  } else {
    if (!isValidSiteName(name)) throw new Error('Nome de site inválido.');
    const availVirtual = `/etc/nginx/sites-available/${name}`;
    const enabledVirtual = `/etc/nginx/sites-enabled/${name}`;
    const availReal = hostPath(availVirtual);
    const enabledReal = hostPath(enabledVirtual);

    let enabledExists = false;
    let isSym = false;
    try {
      const lst = lstatSync(enabledReal);
      enabledExists = true;
      isSym = lst.isSymbolicLink();
    } catch {
      enabledExists = false;
    }

    if (enabled) {
      if (!existsSync(availReal) && !enabledExists) {
        throw new Error(`Site "${name}" não encontrado em sites-available.`);
      }
      if (!enabledExists) {
        if (!IS_HOST_MOUNT) {
          try {
            symlinkSync(availVirtual, enabledReal);
          } catch {
            const r = await execHostSudo(`ln -sfn ${JSON.stringify(availVirtual)} ${JSON.stringify(enabledVirtual)}`);
            if (r.code !== 0) throw new Error(r.stderr || r.error || 'Falha ao ativar site no Nginx.');
          }
        } else {
          const r = await execHostSudo(`ln -sfn ${JSON.stringify(availVirtual)} ${JSON.stringify(enabledVirtual)}`);
          if (r.code !== 0) throw new Error(r.stderr || r.error || 'Falha ao ativar site no Nginx.');
        }
      }
    } else if (enabledExists) {
      if (!isSym && !existsSync(availReal)) {
        if (!IS_HOST_MOUNT) {
          try {
            copyFileSync(enabledReal, availReal);
          } catch {
            await execHostSudo(`cp -f ${JSON.stringify(enabledVirtual)} ${JSON.stringify(availVirtual)}`);
          }
        } else {
          await execHostSudo(`cp -f ${JSON.stringify(enabledVirtual)} ${JSON.stringify(availVirtual)}`);
        }
      }
      if (!IS_HOST_MOUNT) {
        try {
          unlinkSync(enabledReal);
        } catch {
          const r = await execHostSudo(`rm -f ${JSON.stringify(enabledVirtual)}`);
          if (r.code !== 0) throw new Error(r.stderr || r.error || 'Falha ao desativar site.');
        }
      } else {
        const r = await execHostSudo(`rm -f ${JSON.stringify(enabledVirtual)}`);
        if (r.code !== 0) throw new Error(r.stderr || r.error || 'Falha ao desativar site.');
      }
    }
  }

  const testResult = await testNginxConfig();
  let reloadResult = null;
  if (reloadAfter && testResult.ok) {
    const r = await execHostSudo(buildServiceShellCmd('reload'), { timeout: 15000 });
    reloadResult = {
      ok: r.code === 0,
      output: (r.stdout || r.stderr || '').trim(),
    };
  }

  recordSshAudit({
    ...actor,
    action: enabled ? 'nginx.site.enable' : 'nginx.site.disable',
    detail: `Site "${name}" ${enabled ? 'ativado' : 'desativado'}${reloadResult?.ok ? ' · nginx recarregado' : ''}`,
    status: testResult.ok ? 'ok' : 'error',
    outputPreview: testResult.output,
  });

  return {
    ok: true,
    name,
    enabled,
    testResult,
    reloadResult,
    overview: await getNginxOverview(),
  };
}

export async function deleteNginxSite({ name, scope = 'site', reloadAfter = true }, actor = {}) {
  if (!isValidSiteName(name)) throw new Error('Nome de site inválido.');
  if (name === 'default' || name === 'nginx.conf') {
    throw new Error('Não é permitido excluir o arquivo padrão do sistema.');
  }

  if (scope === 'conf.d') {
    const vPath = `/etc/nginx/conf.d/${name}`;
    const rPath = hostPath(vPath);
    if (!IS_HOST_MOUNT) {
      try {
        if (existsSync(rPath)) unlinkSync(rPath);
      } catch {
        const r = await execHostSudo(`rm -f ${JSON.stringify(vPath)}`);
        if (r.code !== 0) throw new Error(r.stderr || r.error || 'Falha ao excluir arquivo de conf.d.');
      }
    } else {
      const r = await execHostSudo(`rm -f ${JSON.stringify(vPath)}`);
      if (r.code !== 0) throw new Error(r.stderr || r.error || 'Falha ao excluir arquivo de conf.d.');
    }
  } else {
    const availVirtual = `/etc/nginx/sites-available/${name}`;
    const enabledVirtual = `/etc/nginx/sites-enabled/${name}`;
    const availReal = hostPath(availVirtual);
    const enabledReal = hostPath(enabledVirtual);
    if (!IS_HOST_MOUNT) {
      try {
        try {
          if (lstatSync(enabledReal)) unlinkSync(enabledReal);
        } catch {
          /* ignore */
        }
        if (existsSync(availReal)) unlinkSync(availReal);
      } catch {
        const r = await execHostSudo(`rm -f ${JSON.stringify(enabledVirtual)} ${JSON.stringify(availVirtual)}`);
        if (r.code !== 0) throw new Error(r.stderr || r.error || 'Falha ao remover arquivos do site.');
      }
    } else {
      const r = await execHostSudo(`rm -f ${JSON.stringify(enabledVirtual)} ${JSON.stringify(availVirtual)}`);
      if (r.code !== 0) throw new Error(r.stderr || r.error || 'Falha ao remover arquivos do site.');
    }
  }

  const testResult = await testNginxConfig();
  let reloadResult = null;
  if (reloadAfter && testResult.ok) {
    const r = await execHostSudo(buildServiceShellCmd('reload'), { timeout: 15000 });
    reloadResult = {
      ok: r.code === 0,
      output: (r.stdout || r.stderr || '').trim(),
    };
  }

  recordSshAudit({
    ...actor,
    action: 'nginx.site.delete',
    detail: `Site "${name}" (${scope}) removido`,
    status: testResult.ok ? 'ok' : 'error',
    outputPreview: testResult.output,
  });

  return {
    ok: true,
    name,
    testResult,
    reloadResult,
    overview: await getNginxOverview(),
  };
}

export async function getNginxLogs({ kind = 'error', lines = 120 } = {}) {
  const maxLines = Math.max(20, Math.min(500, Number(lines) || 120));

  if (kind === 'journal') {
    const cmd = `journalctl -u nginx -n ${maxLines} --no-pager -o short-iso`;
    const r = await execHostSudo(cmd, { timeout: 10000 });
    if (r.code === 0 && r.stdout.trim()) {
      return {
        ok: true,
        kind,
        source: 'journalctl -u nginx',
        lines: r.stdout.trim().split('\n'),
      };
    }
    if (!IS_HOST_MOUNT) {
      const local = await execLocal('journalctl', [
        '-u',
        'nginx',
        '-n',
        String(maxLines),
        '--no-pager',
        '-o',
        'short-iso',
      ]);
      if (local.stdout.trim()) {
        return {
          ok: true,
          kind,
          source: 'journalctl -u nginx',
          lines: local.stdout.trim().split('\n'),
        };
      }
    }
  }

  const baseFile = kind === 'access' ? 'access.log' : 'error.log';
  const primaryVirtual = `/var/log/nginx/${baseFile}`;
  const rotatedVirtual = `/var/log/nginx/${baseFile}.1`;
  const primaryReal = hostPath(primaryVirtual);
  const rotatedReal = hostPath(rotatedVirtual);

  let collected = [];
  let sourceUsed = primaryVirtual;

  try {
    if (existsSync(primaryReal)) {
      const raw = readFileSync(primaryReal, 'utf8').trim();
      if (raw) collected = raw.split('\n');
    }
    if (collected.length < maxLines && existsSync(rotatedReal)) {
      const rawRot = readFileSync(rotatedReal, 'utf8').trim();
      if (rawRot) {
        const rotLines = rawRot.split('\n');
        collected = [...rotLines.slice(-(maxLines - collected.length)), ...collected];
        sourceUsed =
          collected.length === rotLines.slice(-(maxLines - collected.length)).length
            ? `${rotatedVirtual} (rotacionado)`
            : `${rotatedVirtual} + ${primaryVirtual}`;
      }
    }
    return {
      ok: true,
      kind,
      source: sourceUsed,
      lines: collected.slice(-maxLines),
    };
  } catch {
    const cmd = `tail -n ${maxLines} ${JSON.stringify(rotatedVirtual)} ${JSON.stringify(primaryVirtual)} 2>/dev/null`;
    const r = await execHostSudo(cmd, { timeout: 10000 });
    if (r.code === 0) {
      const outLines = r.stdout
        .split('\n')
        .filter((l) => !l.startsWith('==> ') && l.trim().length > 0)
        .slice(-maxLines);
      return {
        ok: true,
        kind,
        source: `${primaryVirtual} (via sudo)`,
        lines: outLines,
      };
    }
    return {
      ok: false,
      kind,
      source: primaryVirtual,
      error: 'Sem permissão para ler /var/log/nginx. Configure o Cofre Sudo para ler os logs.',
      lines: [],
    };
  }
}
