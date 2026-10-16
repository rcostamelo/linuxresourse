import crypto from 'node:crypto';
import * as db from './db.js';
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
  const parts = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
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

export function sessionFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const tokenHash = sha256(token);
  const session = db.getSession(tokenHash);
  if (!session) return null;
  if (session.expiresAt - Date.now() < SESSION_MS / 2) {
    const expiresAt = Date.now() + SESSION_MS;
    db.touchSession(tokenHash, expiresAt);
    session.expiresAt = expiresAt;
  }
  return { ...session, token };
}

function startSession(userId, req, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const expiresAt = Date.now() + SESSION_MS;
  db.createSession({
    tokenHash,
    userId,
    expiresAt,
    ip: clientIp(req),
    userAgent: req.headers['user-agent'] || null,
  });
  appendSetCookie(res, cookieString(req, token, Math.floor(SESSION_MS / 1000)));
  return { token, tokenHash, expiresAt };
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

export function status(req) {
  const session = sessionFromRequest(req);
  return {
    setup: isSetupNeeded(),
    authenticated: !!session,
    user: session?.user ?? null,
    sessionExpiresAt: session?.expiresAt ?? null,
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

export function setupAdmin(username, password, req, res) {
  if (!isSetupNeeded()) throw httpError(409, 'já existe um usuário cadastrado');
  const user = createAccount(username, password, 'admin');
  startSession(user.id, req, res);
  return user;
}

export function login(username, password, req, res) {
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
  startSession(row.id, req, res);
  return db.publicUser(db.findUserById(row.id));
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
