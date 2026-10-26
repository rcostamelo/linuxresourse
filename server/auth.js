import crypto from 'node:crypto';
import * as db from './db.js';
import { getSystem } from './system.js';
import {
  COOKIE_NAME,
  SESSION_TTL_DAYS,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_WINDOW_MS,
  TRUST_PROXY,
} from './config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
// hash descartável usado na verificação quando o usuário não existe (ver login)
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function validateUsername(username) {
  const u = String(username ?? '').trim();
  if (u.length < 3) return 'o usuário precisa ter ao menos 3 caracteres';
  if (u.length > 32) return 'o usuário pode ter no máximo 32 caracteres';
  if (!/^[a-zA-Z0-9._-]+$/.test(u)) return 'use apenas letras, números, ponto, hífen ou underline';
  return null;
}

export function validatePassword(password) {
  const p = String(password ?? '');
  if (p.length < 8) return 'a senha precisa ter ao menos 8 caracteres';
  if (p.length > 200) return 'senha muito longa';
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return 'inclua ao menos uma letra e um número';
  return null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/* -------------------------------- cookies -------------------------------- */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    out[k] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function appendSetCookie(res, value) {
  if (!res) return;
  if (!res.__setCookies) res.__setCookies = [];
  res.__setCookies.push(value);
}

export function drainCookies(res) {
  const cookies = res.__setCookies || [];
  res.__setCookies = [];
  return cookies;
}

function secureContext(req) {
  if (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').toLowerCase().includes('https')) return true;
  return !!req.socket?.encrypted;
}

function cookieString(req, value, maxAge) {
  const expires =
    maxAge > 0 ? new Date(Date.now() + maxAge * 1000).toUTCString() : new Date(0).toUTCString();
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Expires=${expires}`,
  ];
  if (secureContext(req)) parts.push('Secure');
  return parts.join('; ');
}

export function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket?.remoteAddress || 'desconhecido';
}

/* -------------------------------- sessions ------------------------------- */

function extractHeaderToken(req) {
  const direct = req.headers?.['x-session-token'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const authHeader = req.headers?.authorization;
  if (typeof authHeader === 'string' && /^Bearer\s+/i.test(authHeader)) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  return null;
}

export function sessionFromRequest(req, res = null) {
  const cookieToken = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const headerToken = extractHeaderToken(req);
  const token = cookieToken || headerToken;
  if (!token) return null;
  const tokenHash = sha256(token);
  const session = db.getSession(tokenHash);
  if (!session) return null;
  const remaining = session.expiresAt - Date.now();
  // Se a sessão estiver com menos de 3 dias restantes ou menos de metade do tempo padrão,
  // renova no banco e também atualiza o Set-Cookie no navegador (sliding session).
  if (remaining < 3 * 24 * 60 * 60 * 1000 || remaining < SESSION_MS / 2) {
    const renewDays = Math.max(SESSION_TTL_DAYS, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
    const renewMs = renewDays * 24 * 60 * 60 * 1000;
    const expiresAt = Date.now() + renewMs;
    db.touchSession(tokenHash, expiresAt);
    session.expiresAt = expiresAt;
    if (res) {
      appendSetCookie(res, cookieString(req, token, Math.floor(renewMs / 1000)));
    }
  } else if (!cookieToken && headerToken && res && remaining > 0) {
    // Restaura o cookie HttpOnly caso a WebView tenha perdido o cookie mas enviado X-Session-Token
    appendSetCookie(res, cookieString(req, token, Math.floor(remaining / 1000)));
  }
  return { ...session, token };
}

function computeTtlMs({ ttlDays, rememberMe } = {}) {
  const days = ttlDays
    ? Math.max(1, Math.min(365, Number(ttlDays) || 30))
    : (rememberMe === false ? SESSION_TTL_DAYS : 30);
  return { days, ms: days * 24 * 60 * 60 * 1000 };
}

function startSession(userId, req, res, options = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const { days, ms } = computeTtlMs(options);
  const expiresAt = Date.now() + ms;
  db.createSession({
    tokenHash,
    userId,
    expiresAt,
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] || null,
  });
  appendSetCookie(res, cookieString(req, token, Math.floor(ms / 1000)));
  return { token, tokenHash, expiresAt, ttlDays: days };
}

/* ------------------------------ rate limiting ---------------------------- */

const attempts = new Map();

// remove IPs cujas janelas já expiraram, para o mapa não crescer indefinidamente
setInterval(() => {
  const now = Date.now();
  for (const [ip, a] of attempts) {
    if (now - a.firstAt > LOGIN_WINDOW_MS && a.blockedUntil <= now) attempts.delete(ip);
  }
}, LOGIN_WINDOW_MS).unref();

export function loginBlockedSeconds(ip) {
  const a = attempts.get(ip);
  if (!a?.blockedUntil || a.blockedUntil <= Date.now()) return 0;
  return Math.ceil((a.blockedUntil - Date.now()) / 1000);
}

function noteLoginFailure(ip) {
  const now = Date.now();
  let a = attempts.get(ip);
  if (!a || now - a.firstAt > LOGIN_WINDOW_MS) a = { count: 0, firstAt: now, blockedUntil: 0 };
  a.count += 1;
  if (a.count >= LOGIN_MAX_ATTEMPTS) a.blockedUntil = now + LOGIN_WINDOW_MS;
  attempts.set(ip, a);
}

function resetLoginFailures(ip) {
  attempts.delete(ip);
}

/* ---------------------------------- ops ---------------------------------- */

export function isSetupNeeded() {
  return db.countUsers() === 0;
}

export function status(req, res = null) {
  const session = sessionFromRequest(req, res);
  const sys = getSystem();
  const primaryGpu = sys.gpu?.primary || null;
  return {
    setup: isSetupNeeded(),
    authenticated: !!session,
    user: session?.user ?? null,
    sessionExpiresAt: session?.expiresAt ?? null,
    host: {
      hostname: sys.hostname,
      platform: sys.platform,
      arch: sys.arch,
      ncpu: sys.ncpu,
      uptime: sys.uptime,
      gpu: primaryGpu
        ? {
            name: primaryGpu.name,
            vendor: primaryGpu.vendor,
            count: sys.gpu.count,
          }
        : null,
    },
  };
}

export function createAccount(username, password, role = 'admin') {
  const ue = validateUsername(username);
  if (ue) throw httpError(400, ue);
  const pe = validatePassword(password);
  if (pe) throw httpError(400, pe);
  if (db.findUserByUsername(String(username).trim())) throw httpError(409, 'esse usuário já existe');
  return db.createUser({ username: String(username).trim(), passwordHash: hashPassword(password), role });
}

export function setupAdmin(username, password, req, res, options = {}) {
  if (!isSetupNeeded()) throw httpError(409, 'já existe um usuário cadastrado');
  const user = createAccount(username, password, 'admin');
  const sess = startSession(user.id, req, res, options);
  return { user, sessionExpiresAt: sess.expiresAt, token: sess.token };
}

export function login(username, password, req, res, options = {}) {
  const ip = clientIp(req);
  const blocked = loginBlockedSeconds(ip);
  if (blocked) throw httpError(429, `muitas tentativas. tente novamente em ${blocked}s`);

  const row = db.findUserByUsername(String(username ?? '').trim());
  // sempre roda o scrypt, mesmo se o usuário não existir, para não revelar contas pelo tempo de resposta
  const ok = verifyPassword(String(password ?? ''), row ? row.password_hash : DUMMY_HASH) && !!row;
  if (!ok) {
    noteLoginFailure(ip);
    throw httpError(401, 'usuário ou senha inválidos');
  }
  resetLoginFailures(ip);
  db.recordLogin(row.id);
  const sess = startSession(row.id, req, res, options);
  const user = db.publicUser(db.findUserById(row.id));
  return { user, sessionExpiresAt: sess.expiresAt, token: sess.token };
}


export function extendSession(session, req, res, { ttlDays = 30 } = {}) {
  if (!session?.tokenHash) throw httpError(401, 'não autenticado');
  const days = Math.max(1, Math.min(365, Number(ttlDays) || 30));
  const ms = days * 24 * 60 * 60 * 1000;
  const expiresAt = Date.now() + ms;
  db.touchSession(session.tokenHash, expiresAt);
  appendSetCookie(res, cookieString(req, session.token, Math.floor(ms / 1000)));
  return {
    ok: true,
    sessionExpiresAt: expiresAt,
    ttlDays: days,
    token: session.token,
    expiresAtDate: new Date(expiresAt).toISOString(),
  };
}

export function logout(req, res) {
  const session = sessionFromRequest(req);
  if (session) db.deleteSession(session.tokenHash);
  appendSetCookie(res, cookieString(req, '', 0));
}

export function changePassword(session, currentPassword, nextPassword) {
  if (!verifyPassword(String(currentPassword ?? ''), session.passwordHash)) {
    throw httpError(400, 'senha atual incorreta');
  }
  const pe = validatePassword(nextPassword);
  if (pe) throw httpError(400, pe);
  if (verifyPassword(String(nextPassword), session.passwordHash)) {
    throw httpError(400, 'a nova senha deve ser diferente da atual');
  }
  db.updatePassword(session.user.id, hashPassword(String(nextPassword)));
  db.deleteUserSessionsExcept(session.user.id, session.tokenHash);
  return true;
}

/* -------------------- Gerenciamento de Usuários do Painel -------------------- */

export function requireAdmin(session) {
  if (!session?.user) throw httpError(401, 'não autenticado');
  if (session.user.role === 'viewer') {
    throw httpError(403, 'Acesso somente leitura (viewer). Apenas administradores podem executar esta ação.');
  }
}

export function panelUsersOverview(session) {
  const rawSessions = db.listActiveSessions();
  const countByUser = new Map();
  for (const s of rawSessions) {
    countByUser.set(s.user_id, (countByUser.get(s.user_id) || 0) + 1);
  }

  const users = db.listUsers().map((u) => ({
    ...u,
    activeSessions: countByUser.get(u.id) || 0,
  }));

  const sessions = rawSessions.map((s) => ({
    tokenPrefix: String(s.token_hash).slice(0, 16),
    userId: s.user_id,
    username: s.username,
    role: s.role,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    ip: s.ip,
    userAgent: s.user_agent,
    current: s.token_hash === session?.tokenHash,
  }));

  return { ts: Date.now(), users, sessions };
}

export function adminCreatePanelUser(session, { username, password, role }) {
  requireAdmin(session);
  const cleanRole = role === 'viewer' ? 'viewer' : 'admin';
  const created = createAccount(username, password, cleanRole);
  db.recordSshAudit({
    userId: session.user.id,
    username: session.user.username,
    action: 'panel_user.create',
    detail: `Conta do painel "${created.username}" criada com perfil ${cleanRole}`,
    status: 'ok',
  });
  return panelUsersOverview(session);
}

export function adminUpdatePanelUser(session, { id, role, password }) {
  requireAdmin(session);
  const targetId = Number(id);
  const row = db.findUserById(targetId);
  if (!row) throw httpError(404, 'usuário não encontrado');

  if (role !== undefined) {
    const nextRole = role === 'viewer' ? 'viewer' : 'admin';
    if (row.role === 'admin' && nextRole !== 'admin' && db.countAdmins() <= 1) {
      throw httpError(400, 'Não é possível remover o perfil admin do único administrador do painel.');
    }
    db.updateUserRole(targetId, nextRole);
  }

  if (password !== undefined && String(password).trim() !== '') {
    const pe = validatePassword(password);
    if (pe) throw httpError(400, pe);
    db.updatePassword(targetId, hashPassword(String(password)));
    if (targetId === session.user.id) {
      db.deleteUserSessionsExcept(targetId, session.tokenHash);
    } else {
      db.deleteUserSessions(targetId);
    }
  }

  db.recordSshAudit({
    userId: session.user.id,
    username: session.user.username,
    action: 'panel_user.update',
    detail: `Conta do painel "${row.username}" atualizada`,
    status: 'ok',
  });

  return panelUsersOverview(session);
}

export function adminDeletePanelUser(session, { id }) {
  requireAdmin(session);
  const targetId = Number(id);
  if (targetId === session.user.id) {
    throw httpError(400, 'Você não pode excluir a sua própria conta em uso.');
  }
  const row = db.findUserById(targetId);
  if (!row) throw httpError(404, 'usuário não encontrado');
  if (row.role === 'admin' && db.countAdmins() <= 1) {
    throw httpError(400, 'Não é possível excluir o último administrador do painel.');
  }
  db.deleteUser(targetId);
  db.recordSshAudit({
    userId: session.user.id,
    username: session.user.username,
    action: 'panel_user.delete',
    detail: `Conta do painel "${row.username}" removida`,
    status: 'ok',
  });
  return panelUsersOverview(session);
}

export function revokePanelSession(session, { tokenPrefix, allOthers }) {
  if (allOthers) {
    if (session.user.role === 'admin') {
      const all = db.listActiveSessions();
      for (const s of all) {
        if (s.token_hash !== session.tokenHash) db.deleteSession(s.token_hash);
      }
    } else {
      db.deleteUserSessionsExcept(session.user.id, session.tokenHash);
    }
    return panelUsersOverview(session);
  }

  const clean = String(tokenPrefix || '').replace(/[^a-f0-9]/gi, '');
  if (clean.length < 8) throw httpError(400, 'sessão inválida');
  if (session.tokenHash.startsWith(clean)) {
    throw httpError(400, 'Para encerrar a sessão atual, use o botão Sair.');
  }
  const target = db.listActiveSessions().find((s) => String(s.token_hash).startsWith(clean));
  if (!target) throw httpError(404, 'sessão não encontrada');
  if (session.user.role !== 'admin' && target.user_id !== session.user.id) {
    throw httpError(403, 'sem permissão para encerrar sessão de outro usuário');
  }
  db.deleteSession(target.token_hash);
  return panelUsersOverview(session);
}
