import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..');
export const DIST = path.join(ROOT, 'dist');

export const PORT = Number(process.env.PORT) || 10450;
export const HOST = process.env.HOST || '127.0.0.1';

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA_DIR, 'linux-resource.db');
export const LOGOS_DIR = path.join(DATA_DIR, 'logos');

export const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS) || 7;
export const COOKIE_NAME = process.env.COOKIE_NAME || 'lr_session';

export const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS) || 8;
export const LOGIN_WINDOW_MS = (Number(process.env.LOGIN_WINDOW_MIN) || 15) * 60 * 1000;

export const SCAN_ROOT = (process.env.SCAN_ROOT || '').replace(/\/+$/, '');
export const DU_BIN = process.env.DU_BIN || 'du';
export const PING_BIN = process.env.PING_BIN || 'ping';
export const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';

export const SSH_BIN = process.env.SSH_BIN || 'ssh';
export const SSHPASS_BIN = process.env.SSHPASS_BIN || 'sshpass';
export const SSH_CONFIG_FILE = process.env.SSH_CONFIG_FILE
  ? path.resolve(process.env.SSH_CONFIG_FILE)
  : path.join(os.homedir(), '.ssh', 'config');
export const SSH_CONNECT_TIMEOUT = Number(process.env.SSH_CONNECT_TIMEOUT) || 8;
export const SSH_COMMAND_TIMEOUT = Number(process.env.SSH_COMMAND_TIMEOUT) || 20;
export const SSH_CONCURRENCY = Number(process.env.SSH_CONCURRENCY) || 6;
export const SSH_CACHE_MS = (Number(process.env.SSH_CACHE_SEC) || 4) * 1000;

export const TRUST_PROXY = process.env.TRUST_PROXY === '1';
