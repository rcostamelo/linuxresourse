import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LOGOS_DIR } from './config.js';

const MAX_BYTES = 1_500_000;
const NAME_RE = /^[a-f0-9]{32}\.(png|jpg|webp|gif)$/;
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function sniff(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.toString('ascii', 0, 6))) return 'gif';
  return null;
}

function decodeDataUrl(dataUrl) {
  const m = /^data:[\w.+-]+\/[\w.+-]+;base64,([\s\S]+)$/.exec(String(dataUrl ?? '').trim());
  if (!m) return null;
  return Buffer.from(m[1], 'base64');
}

export function saveLogo(dataUrl) {
  const buf = decodeDataUrl(dataUrl);
  if (!buf || buf.length === 0) throw new Error('imagem inválida');
  if (buf.length > MAX_BYTES) throw new Error('imagem muito grande (máx 1,5 MB)');
  const ext = sniff(buf);
  if (!ext) throw new Error('formato não suportado (use PNG, JPG, WEBP ou GIF)');
  mkdirSync(LOGOS_DIR, { recursive: true });
  const name = `${randomBytes(16).toString('hex')}.${ext}`;
  writeFileSync(path.join(LOGOS_DIR, name), buf);
  return name;
}

export function removeLogo(name) {
  if (!name || !NAME_RE.test(name)) return;
  const full = path.join(LOGOS_DIR, name);
  if (existsSync(full)) {
    try {
      unlinkSync(full);
    } catch {
      /* ignora */
    }
  }
}

export function logoFile(name) {
  if (!name || !NAME_RE.test(name)) return null;
  const full = path.join(LOGOS_DIR, name);
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return { full, mime: MIME_BY_EXT[path.extname(name).slice(1)] || 'application/octet-stream' };
}
