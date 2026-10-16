import crypto from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const KEY_FILE = path.join(DATA_DIR, 'master.key');
const PREFIX = 'v1';

let masterKey = null;

function loadKey() {
  if (masterKey) return masterKey;

  const fromEnv = process.env.MASTER_KEY;
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, 'hex');
    if (buf.length !== 32) {
      throw new Error('MASTER_KEY precisa ter 64 caracteres hexadecimais (32 bytes)');
    }
    masterKey = buf;
    return masterKey;
  }

  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(KEY_FILE)) {
    masterKey = Buffer.from(readFileSync(KEY_FILE, 'utf8').trim(), 'hex');
  } else {
    const key = crypto.randomBytes(32);
    writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
    try {
      chmodSync(KEY_FILE, 0o600);
    } catch {
      /* sistemas sem chmod (ex.: alguns volumes) */
    }
    masterKey = key;
  }

  if (masterKey.length !== 32) throw new Error(`chave mestra inválida em ${KEY_FILE}`);
  return masterKey;
}

export function encryptSecret(plain) {
  if (plain == null || plain === '') return null;
  const key = loadKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

export function decryptSecret(enc) {
  if (!enc) return null;
  const [version, ivB64, tagB64, ctB64] = String(enc).split(':');
  if (version !== PREFIX) throw new Error('formato de segredo desconhecido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

export function secretsReady() {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

export { KEY_FILE as MASTER_KEY_FILE };
