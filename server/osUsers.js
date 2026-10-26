import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCAN_ROOT } from './config.js';
import { getSetting, setSetting, deleteSetting, recordSshAudit } from './db.js';
import { encryptSecret, decryptSecret } from './secrets.js';

export const IS_HOST_MOUNT = Boolean(SCAN_ROOT && SCAN_ROOT !== '/');

export function hostPath(p) {
  if (!IS_HOST_MOUNT) return p;
  return path.join(SCAN_ROOT, String(p).replace(/^\/+/, ''));
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function exec(bin, args, { timeout = 120000, input = null } = {}) {
  return new Promise((resolve) => {
    const child = execFile(bin, args, { maxBuffer: 16 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      resolve({
        code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: err ? String(err.message || err) : null,
      });
    });
    if (input != null && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/* ------------------------ Leitura de /etc/passwd e /etc/group -------------- */

export function readPasswdUsers() {
  const file = hostPath('/etc/passwd');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const groupsMap = readGroupsMap();

  const users = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(':');
    if (parts.length < 7) continue;
    const [username, , uidStr, gidStr, gecos, home, shell] = parts;
    const uid = Number(uidStr);
    const gid = Number(gidStr);
    if (!Number.isFinite(uid) || !Number.isFinite(gid)) continue;

    const fullName = (gecos || '').split(',')[0].trim();
    const primaryGroup = groupsMap.byGid.get(gid)?.name || String(gid);
    const suppGroups = groupsMap.byMember.get(username) || [];
    const allGroups = Array.from(new Set([primaryGroup, ...suppGroups]));
    const isHuman = uid === 0 || (uid >= 1000 && uid < 60000);
    const isSudoer =
      uid === 0 ||
      allGroups.includes('sudo') ||
      allGroups.includes('wheel') ||
      allGroups.includes('admin');
    const isDocker = allGroups.includes('docker');
    const homeExists = home ? existsSync(hostPath(home)) : false;

    users.push({
      username,
      uid,
      gid,
      fullName,
      home,
      shell: shell || '/bin/sh',
      primaryGroup,
      groups: suppGroups,
      allGroups,
      isHuman,
      isSudoer,
      isDocker,
      homeExists,
    });
  }

  users.sort((a, b) => {
    if (a.isHuman !== b.isHuman) return a.isHuman ? -1 : 1;
    if (a.uid === 0) return -1;
    if (b.uid === 0) return 1;
    return a.username.localeCompare(b.username);
  });

  return users;
}

export function readGroupsMap() {
  const file = hostPath('/etc/group');
  const byGid = new Map();
  const byName = new Map();
  const byMember = new Map();

  if (!existsSync(file)) return { byGid, byName, byMember, all: [] };
  const text = readFileSync(file, 'utf8');
  const all = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(':');
    if (parts.length < 4) continue;
    const [name, , gidStr, membersStr] = parts;
    const gid = Number(gidStr);
    const members = (membersStr || '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    const obj = { name, gid, members };
    byGid.set(gid, obj);
    byName.set(name, obj);
    all.push(obj);
    for (const m of members) {
      if (!byMember.has(m)) byMember.set(m, []);
      byMember.get(m).push(name);
    }
  }
  all.sort((a, b) => a.name.localeCompare(b.name));
  return { byGid, byName, byMember, all };
}

export function readAvailableShells() {
  const file = hostPath('/etc/shells');
  const defaults = ['/bin/bash', '/bin/sh', '/bin/zsh', '/usr/sbin/nologin', '/bin/false'];
  if (!existsSync(file)) return defaults;
  try {
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .map((l) => l.replace(/#.*$/, '').trim())
      .filter((l) => l.startsWith('/'));
    return Array.from(new Set([...lines, '/usr/sbin/nologin', '/bin/false']));
  } catch {
    return defaults;
  }
}

export function detectPrimaryHostUser() {
  if (!IS_HOST_MOUNT) {
    return { username: os.userInfo().username, uid: process.getuid?.() ?? 1000, home: os.homedir() };
  }
  const users = readPasswdUsers();
  const u1000 = users.find((u) => u.uid === 1000 && u.home?.startsWith('/home/'));
  if (u1000) return u1000;
  const human = users.find((u) => u.uid >= 1000 && u.uid < 60000 && u.home?.startsWith('/home/'));
  if (human) return human;
  return { username: 'root', uid: 0, home: '/root' };
}

/* ------------------------ Cofre de Credencial Sudo ------------------------- */

const SUDO_SETTING_KEY = 'host_sudo_cred_v1';
let nopasswdCache = { ts: 0, user: '', ok: false };

export function getSavedSudoMeta() {
  try {
    const raw = getSetting(SUDO_SETTING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.username || !parsed?.passwordEnc) return null;
    return {
      username: String(parsed.username),
      passwordEnc: String(parsed.passwordEnc),
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    return null;
  }
}

function runHostChroot(hostCmd, { timeout = 120000, input = null } = {}) {
  const args = [
    'run',
    '--rm',
    ...(input != null ? ['-i'] : []),
    '-u',
    '0:0',
    '--privileged',
    '--pid=host',
    '--net=host',
    '-e',
    'SYSTEMD_IGNORE_CHROOT=1',
    '-v',
    '/:/host',
    '-v',
    '/run:/host/run',
    '-v',
    '/dev:/host/dev',
    '-v',
    '/proc:/host/proc',
    '-v',
    '/sys:/host/sys',
    '--entrypoint',
    'sh',
    'linux-resource:latest',
    '-c',
    hostCmd,
  ];
  return exec('docker', args, { timeout, input });
}

/**
 * Executa um comando no host autenticando com sudo -S (ou diretamente se já for root/nopasswd).
 */
export async function execHostSudo(shellCommand, { overrideCred = null, timeout = 120000 } = {}) {
  const primary = detectPrimaryHostUser();
  const saved = overrideCred || getSavedSudoMeta();
  const sudoUser = saved?.username || primary.username;
  let password = null;

  if (overrideCred?.password != null) {
    password = String(overrideCred.password);
  } else if (saved?.passwordEnc) {
    try {
      password = decryptSecret(saved.passwordEnc);
    } catch {
      password = null;
    }
  }

  // Caso 1: Execução nativa fora de container Docker
  if (!IS_HOST_MOUNT) {
    if (process.getuid?.() === 0) {
      return exec('sh', ['-c', shellCommand], { timeout });
    }
    const nopass = await exec('sudo', ['-n', 'true'], { timeout: 5000 });
    if (nopass.code === 0) {
      return exec('sudo', ['-n', 'sh', '-c', shellCommand], { timeout });
    }
    if (password != null) {
      return exec('sudo', ['-S', '-k', '-p', '', 'sh', '-c', shellCommand], {
        timeout,
        input: `${password}\n`,
      });
    }
    return {
      code: 1,
      stdout: '',
      stderr: 'sudo: senha não configurada no cofre do sistema.',
      error: 'requires_sudo_password',
    };
  }

  // Caso 2: Container Docker com /host e /var/run/docker.sock
  if (overrideCred?.password != null) {
    // Durante "Validar e Salvar", testa a senha real do usuário no PAM/sudo do host
    const innerSudo = `sudo -S -k -p '' sh -c ${shQuote(shellCommand)}`;
    const hostCmd =
      sudoUser === 'root'
        ? `chroot /host sh -c ${shQuote(shellCommand)}`
        : `chroot /host su ${sudoUser} -s /bin/sh -c ${shQuote(innerSudo)}`;

    return runHostChroot(hostCmd, {
      timeout,
      input: sudoUser === 'root' ? null : `${password}\n`,
    });
  }

  if (password != null) {
    // Com credencial sudo já validada e salva no cofre, executa diretamente no chroot do host
    const hostCmd = `chroot /host sh -c ${shQuote(shellCommand)}`;
    return runHostChroot(hostCmd, { timeout });
  }

  // Sem senha salva: verifica se o usuário no host possui NOPASSWD configurado
  const nopassCheck = `chroot /host su ${sudoUser} -s /bin/sh -c ${shQuote('sudo -n true')}`;
  const res = await runHostChroot(nopassCheck, { timeout: 6000 });
  if (res.code !== 0) {
    return {
      ...res,
      error: 'requires_sudo_password',
    };
  }
  const nopassInner = `sudo -n sh -c ${shQuote(shellCommand)}`;
  const nopassCmd = `chroot /host su ${sudoUser} -s /bin/sh -c ${shQuote(nopassInner)}`;
  return runHostChroot(nopassCmd, { timeout });
}

/**
 * Executa um comando no host como o usuário comum (sem sudo), útil para limpar ~/.cache ou ~/.npm.
 */
export async function execAsHostRegularUser(shellCommand, { timeout = 120000 } = {}) {
  const primary = detectPrimaryHostUser();
  if (!IS_HOST_MOUNT) {
    return exec('sh', ['-c', shellCommand], { timeout });
  }
  const hostCmd = `chroot /host su - ${primary.username} -c ${shQuote(shellCommand)}`;
  return runHostChroot(hostCmd, { timeout });
}

export async function getSudoStatus() {
  const primary = detectPrimaryHostUser();
  const saved = getSavedSudoMeta();
  const nativeRoot = !IS_HOST_MOUNT && process.getuid?.() === 0;
  const targetUser = saved?.username || primary.username;

  let canSudo = false;
  let method = 'none'; // 'root' | 'nopasswd' | 'vault' | 'none'

  if (nativeRoot) {
    canSudo = true;
    method = 'root';
  } else if (saved) {
    canSudo = true;
    method = 'vault';
  } else {
    const now = Date.now();
    if (nopasswdCache.user === targetUser && now - nopasswdCache.ts < 60000) {
      if (nopasswdCache.ok) {
        canSudo = true;
        method = 'nopasswd';
      }
    } else {
      const r = await execHostSudo('true', { timeout: 6000 });
      const ok = r.code === 0;
      nopasswdCache = { ts: now, user: targetUser, ok };
      if (ok) {
        canSudo = true;
        method = 'nopasswd';
      }
    }
  }

  const users = readPasswdUsers().filter((u) => u.isHuman);
  return {
    canSudo,
    isRoot: nativeRoot,
    method,
    configuredUser: targetUser,
    hasSavedPassword: !!saved,
    updatedAt: saved?.updatedAt || null,
    humanUsers: users.map((u) => ({ username: u.username, uid: u.uid, isSudoer: u.isSudoer })),
  };
}

export async function saveAndVerifySudo({ username, password }, actor = {}) {
  const user = String(username || '').trim();
  const pass = String(password || '');
  if (!user) throw new Error('Informe o usuário administrador (sudo).');
  if (!pass) throw new Error('Informe a senha sudo do usuário.');

  const r = await execHostSudo('id -u', {
    overrideCred: { username: user, password: pass },
    timeout: 15000,
  });

  const lastLine = r.stdout.trim().split('\n').pop()?.trim();
  if (r.code !== 0 || lastLine !== '0') {
    const rawMsg = (r.stderr || r.error || 'Senha incorreta ou usuário sem permissão sudo').trim();
    const cleanMsg = rawMsg
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/Authentication required but not attempted/i.test(l))
      .join(' · ');
    throw new Error(`Falha ao validar sudo para "${user}": ${cleanMsg || 'Senha incorreta'}`);
  }

  const payload = {
    username: user,
    passwordEnc: encryptSecret(pass),
    updatedAt: Date.now(),
  };
  setSetting(SUDO_SETTING_KEY, JSON.stringify(payload));

  recordSshAudit({
    ...actor,
    action: 'sudo.configure',
    detail: `Credencial sudo validada e salva no cofre para o usuário do SO "${user}"`,
    status: 'ok',
  });

  return getSudoStatus();
}

export async function clearSudoCredential(actor = {}) {
  deleteSetting(SUDO_SETTING_KEY);
  recordSshAudit({
    ...actor,
    action: 'sudo.clear',
    detail: 'Credencial sudo removida do cofre',
    status: 'ok',
  });
  return getSudoStatus();
}

/* ------------------------ CRUD de Usuários do SO --------------------------- */

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const GROUP_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const SAFE_TEXT_RE = /^[^:\n\r]*$/;

async function readLockedUsersSet() {
  const locked = new Set();
  const shadowPath = hostPath('/etc/shadow');
  try {
    if (existsSync(shadowPath)) {
      const txt = readFileSync(shadowPath, 'utf8');
      for (const line of txt.split('\n')) {
        const [u, hash] = line.split(':');
        if (u && hash && (hash.startsWith('!') || hash.startsWith('*'))) {
          locked.add(u);
        }
      }
    }
  } catch {
    /* sem leitura direta de /etc/shadow */
  }
  return locked;
}

async function readLoggedInUsersSet() {
  const active = new Set();
  try {
    const utmp = IS_HOST_MOUNT && existsSync(hostPath('/run/utmp')) ? [hostPath('/run/utmp')] : [];
    const r = await exec('who', utmp, { timeout: 4000 });
    for (const line of r.stdout.split('\n')) {
      const u = line.trim().split(/\s+/)[0];
      if (u) active.add(u);
    }
  } catch {
    /* ignore */
  }
  return active;
}

export async function listOsUsersOverview() {
  const [sudoStatus, lockedSet, loggedInSet] = await Promise.all([
    getSudoStatus(),
    readLockedUsersSet(),
    readLoggedInUsersSet(),
  ]);

  const users = readPasswdUsers().map((u) => ({
    ...u,
    locked: lockedSet.has(u.username),
    loggedIn: loggedInSet.has(u.username),
  }));

  const groups = readGroupsMap().all;
  const shells = readAvailableShells();

  return {
    ts: Date.now(),
    sudo: sudoStatus,
    users,
    groups: groups.map((g) => ({ name: g.name, gid: g.gid, count: g.members.length })),
    shells,
  };
}

export async function createOsUser(input, actor = {}) {
  const username = String(input?.username || '').trim();
  const fullName = String(input?.fullName || '').trim();
  const shell = String(input?.shell || '/bin/bash').trim();
  const password = String(input?.password || '');
  const createHome = input?.createHome !== false;
  const groups = Array.isArray(input?.groups)
    ? input.groups.map((g) => String(g).trim()).filter((g) => GROUP_RE.test(g))
    : [];

  if (!USERNAME_RE.test(username)) {
    throw new Error('Nome de usuário inválido (use letras minúsculas, números, _ ou -, iniciando por letra).');
  }
  if (!SAFE_TEXT_RE.test(fullName) || fullName.length > 80) {
    throw new Error('Nome completo inválido.');
  }
  if (!shell.startsWith('/') || !SAFE_TEXT_RE.test(shell)) {
    throw new Error('Shell inválido.');
  }
  if (password.length < 4) {
    throw new Error('Defina uma senha inicial com pelo menos 4 caracteres.');
  }

  const existing = readPasswdUsers().find((u) => u.username === username);
  if (existing) {
    throw new Error(`O usuário "${username}" já existe no sistema.`);
  }

  const args = [];
  if (createHome) args.push('-m');
  args.push('-s', shQuote(shell));
  if (fullName) args.push('-c', shQuote(fullName));
  if (groups.length > 0) args.push('-G', shQuote(groups.join(',')));
  args.push(shQuote(username));

  const chpasswdLine = `${username}:${password}`;
  const cmd = `useradd ${args.join(' ')} && printf '%s\\n' ${shQuote(chpasswdLine)} | chpasswd`;

  const r = await execHostSudo(cmd);
  if (r.code !== 0) {
    const err = (r.stderr || r.error || 'Erro ao criar usuário').trim();
    recordSshAudit({
      ...actor,
      action: 'os_user.create',
      detail: `Falha ao criar "${username}": ${err}`,
      status: 'error',
    });
    throw new Error(err);
  }

  recordSshAudit({
    ...actor,
    action: 'os_user.create',
    detail: `Usuário do SO "${username}" criado (grupos: ${groups.join(',') || 'padrão'})`,
    status: 'ok',
  });

  return listOsUsersOverview();
}

export async function updateOsUser(input, actor = {}) {
  const username = String(input?.username || '').trim();
  if (!USERNAME_RE.test(username)) throw new Error('Usuário inválido.');

  const existing = readPasswdUsers().find((u) => u.username === username);
  if (!existing) throw new Error(`Usuário "${username}" não encontrado.`);

  const fullName = input?.fullName !== undefined ? String(input.fullName).trim() : existing.fullName;
  const shell = input?.shell !== undefined ? String(input.shell).trim() : existing.shell;
  const password = input?.password != null ? String(input.password) : '';
  const groups = Array.isArray(input?.groups)
    ? input.groups.map((g) => String(g).trim()).filter((g) => GROUP_RE.test(g))
    : existing.groups;

  if (!SAFE_TEXT_RE.test(fullName) || fullName.length > 80) throw new Error('Nome completo inválido.');
  if (!shell.startsWith('/') || !SAFE_TEXT_RE.test(shell)) throw new Error('Shell inválido.');

  const cmds = [];
  const modArgs = ['-c', shQuote(fullName), '-s', shQuote(shell)];
  if (existing.uid !== 0) {
    modArgs.push('-G', shQuote(groups.join(',')));
  }
  modArgs.push(shQuote(username));
  cmds.push(`usermod ${modArgs.join(' ')}`);

  if (typeof input?.locked === 'boolean' && existing.uid !== 0) {
    cmds.push(`usermod ${input.locked ? '-L' : '-U'} ${shQuote(username)}`);
  }

  if (password.trim() !== '') {
    if (password.length < 4) throw new Error('A nova senha precisa ter pelo menos 4 caracteres.');
    const chpasswdLine = `${username}:${password}`;
    cmds.push(`printf '%s\\n' ${shQuote(chpasswdLine)} | chpasswd`);
  }

  const r = await execHostSudo(cmds.join(' && '));
  if (r.code !== 0) {
    const err = (r.stderr || r.error || 'Erro ao atualizar usuário').trim();
    recordSshAudit({
      ...actor,
      action: 'os_user.update',
      detail: `Falha ao atualizar "${username}": ${err}`,
      status: 'error',
    });
    throw new Error(err);
  }

  recordSshAudit({
    ...actor,
    action: 'os_user.update',
    detail: `Usuário do SO "${username}" atualizado (grupos: ${groups.join(',') || 'nenhum'}${password ? ', senha alterada' : ''})`,
    status: 'ok',
  });

  return listOsUsersOverview();
}

export async function deleteOsUser(input, actor = {}) {
  const username = String(input?.username || '').trim();
  const removeHome = Boolean(input?.removeHome);
  if (!USERNAME_RE.test(username)) throw new Error('Usuário inválido.');

  const existing = readPasswdUsers().find((u) => u.username === username);
  if (!existing) throw new Error(`Usuário "${username}" não encontrado.`);
  if (existing.uid < 1000) {
    throw new Error(`Por segurança, contas de sistema ou root (UID ${existing.uid}) não podem ser removidas pelo painel.`);
  }

  const primary = detectPrimaryHostUser();
  if (existing.username === primary.username) {
    throw new Error(`Não é permitido remover o usuário principal do host (${primary.username}).`);
  }

  const cmd = `userdel ${removeHome ? '-r ' : ''}${shQuote(username)}`;
  const r = await execHostSudo(cmd);
  if (r.code !== 0) {
    const err = (r.stderr || r.error || 'Erro ao remover usuário').trim();
    recordSshAudit({
      ...actor,
      action: 'os_user.delete',
      detail: `Falha ao remover "${username}": ${err}`,
      status: 'error',
    });
    throw new Error(err);
  }

  recordSshAudit({
    ...actor,
    action: 'os_user.delete',
    detail: `Usuário do SO "${username}" removido (${removeHome ? 'com /home removido' : 'mantendo /home'})`,
    status: 'ok',
  });

  return listOsUsersOverview();
}
