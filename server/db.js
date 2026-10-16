import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DB_FILE } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  password_changed_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

let db = null;

export function initDb() {
  if (db) return db;
  mkdirSync(path.dirname(DB_FILE), { recursive: true });
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  purgeExpiredSessions();
  return db;
}

function get() {
  if (!db) throw new Error('banco não inicializado');
  return db;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

export function countUsers() {
  return get().prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

export function findUserByUsername(username) {
  return get().prepare('SELECT * FROM users WHERE username = ?').get(username) ?? null;
}

export function findUserById(id) {
  return get().prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function createUser({ username, passwordHash, role = 'admin' }) {
  const now = Date.now();
  const r = get()
    .prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
    .run(username, passwordHash, role, now);
  return publicUser(findUserById(Number(r.lastInsertRowid)));
}

export function recordLogin(id) {
  get().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), id);
}

export function updatePassword(id, passwordHash) {
  get().prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(
    passwordHash,
    Date.now(),
    id,
  );
}

export function listUsers() {
  return get().prepare('SELECT * FROM users ORDER BY id').all().map(publicUser);
}

export function createSession({ tokenHash, userId, expiresAt, ip, userAgent }) {
  get()
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(tokenHash, userId, Date.now(), expiresAt, ip ?? null, userAgent ?? null);
}

export function getSession(tokenHash) {
  const row = get()
    .prepare(
      `SELECT s.token_hash, s.expires_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return null;
  if (row.expires_at <= Date.now()) {
    deleteSession(tokenHash);
    return null;
  }
  return { tokenHash, expiresAt: row.expires_at, user: publicUser(row), passwordHash: row.password_hash };
}

export function touchSession(tokenHash, expiresAt) {
  get().prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expiresAt, tokenHash);
}

export function deleteSession(tokenHash) {
  get().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteUserSessions(userId) {
  get().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function deleteUserSessionsExcept(userId, keepTokenHash) {
  get().prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, keepTokenHash);
}

export function deleteUser(id) {
  get().prepare('DELETE FROM users WHERE id = ?').run(id);
}

export function purgeExpiredSessions() {
  return get().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()).changes;
}

export { publicUser };
