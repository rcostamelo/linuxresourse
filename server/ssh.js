import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR,
  SSHPASS_BIN,
  SSH_BIN,
  SSH_CACHE_MS,
  SSH_COMMAND_TIMEOUT,
  SSH_CONCURRENCY,
  SSH_CONFIG_FILE,
  SSH_CONNECT_TIMEOUT,
} from './config.js';
import { decryptSecret } from './secrets.js';
import { recordSshHistory } from './db.js';

const KNOWN_HOSTS = path.join(DATA_DIR, 'known_hosts');

const VIRTUAL_IFACE = /^(lo|veth|br-|docker|virbr|tun|tap|vnet|dummy|sit|bond|wg)/;
const PSEUDO_FS = /^(tmpfs|devtmpfs|shm|none|ramfs|udev|squashfs|overlay)$/;

const REMOTE_CMD = [
  'LC_ALL=C',
  'echo "@@UNAME"; uname -srm',
  'echo "@@OS"; ( . /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-$NAME}" ) || uname -o 2>/dev/null || true',
  'echo "@@CPU_MODEL"; grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2 || lscpu 2>/dev/null | grep "Model name:" | cut -d: -f2 || true',
  'echo "@@HOST"; hostname',
  'echo "@@NCPU"; nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo',
  'echo "@@LOAD"; cat /proc/loadavg',
  'echo "@@UPTIME"; cat /proc/uptime',
  'echo "@@STAT1"; head -n1 /proc/stat',
  'echo "@@MEM"; cat /proc/meminfo',
  'echo "@@DF"; df -kPT 2>/dev/null || df -kP',
  'echo "@@NET"; cat /proc/net/dev',
  'echo "@@IP"; ip -o -4 addr show 2>/dev/null | awk \'{print $2, $4}\' || true',
  'echo "@@PROCS"; ps -eo pid,user,pcpu,pmem,rss,comm --sort=-pcpu 2>/dev/null | head -n 11 || true',
  'sleep 0.5',
  'echo "@@STAT2"; head -n1 /proc/stat',
].join('; ');

/* ------------------------------- runbooks -------------------------------- */

export const RUNBOOKS = [
  {
    id: 'df_inodes',
    title: 'Espaço em Disco & Inodes',
    desc: 'Lista todos os sistemas de arquivos montados com tamanho legível e uso de inodes.',
    category: 'Armazenamento',
    risk: 'low',
    commandPreview: 'df -hPT && df -iP',
    command: 'LC_ALL=C; echo "=== USO DE DISCO (df -hPT) ==="; df -hPT 2>/dev/null || df -hP; echo ""; echo "=== USO DE INODES (df -iP) ==="; df -iP',
  },
  {
    id: 'top_procs',
    title: 'Top 15 Processos (CPU & RAM)',
    desc: 'Exibe os processos que mais consomem CPU e memória RAM no momento.',
    category: 'Processos',
    risk: 'low',
    commandPreview: 'ps -eo pid,user,pcpu,pmem,rss,etime,args --sort=-pcpu',
    command:
      'LC_ALL=C; echo "=== TOP 15 POR CPU ==="; ps -eo pid,ppid,user,pcpu,pmem,rss,etime,comm --sort=-pcpu | head -n 16; echo ""; echo "=== TOP 15 POR MEMÓRIA ==="; ps -eo pid,ppid,user,pmem,pcpu,rss,etime,comm --sort=-pmem | head -n 16',
  },
  {
    id: 'systemd_status',
    title: 'Serviços Systemd (Falhas & Ativos)',
    desc: 'Lista unidades systemd com falha e os serviços em execução no servidor.',
    category: 'Serviços',
    risk: 'low',
    commandPreview: 'systemctl --failed && systemctl list-units --type=service --state=running',
    command:
      'LC_ALL=C; if command -v systemctl >/dev/null 2>&1; then echo "=== SERVIÇOS COM FALHA ==="; systemctl --failed --no-pager; echo ""; echo "=== SERVIÇOS EM EXECUÇÃO ==="; systemctl list-units --type=service --state=running --no-pager | head -n 45; else echo "systemctl não disponível neste host"; fi',
  },
  {
    id: 'journal_errors',
    title: 'Últimos Erros do Sistema (Logs)',
    desc: 'Busca as últimas 50 linhas de erro crítico/alerta no journalctl ou syslog.',
    category: 'Logs',
    risk: 'low',
    commandPreview: 'journalctl -p err..emerg -n 50 --no-pager',
    command:
      'LC_ALL=C; if command -v journalctl >/dev/null 2>&1; then journalctl -p err..emerg -n 50 --no-pager; else tail -n 50 /var/log/syslog /var/log/messages 2>/dev/null || echo "Sem acesso aos logs do sistema"; fi',
  },
  {
    id: 'listening_ports',
    title: 'Portas em Escuta & Conexões (ss)',
    desc: 'Lista todas as portas TCP/UDP abertas em LISTEN e resumo de sockets.',
    category: 'Rede',
    risk: 'low',
    commandPreview: 'ss -s && ss -tulpn',
    command:
      'LC_ALL=C; echo "=== RESUMO DE SOCKETS ==="; ss -s 2>/dev/null || true; echo ""; echo "=== PORTAS EM ESCUTA ==="; ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null || echo "ss/netstat indisponível"',
  },
  {
    id: 'docker_ps',
    title: 'Status de Containers Docker',
    desc: 'Lista todos os containers Docker do servidor remoto e uso de disco do daemon.',
    category: 'Containers',
    risk: 'low',
    commandPreview: 'docker ps -a && docker system df',
    command:
      'LC_ALL=C; if command -v docker >/dev/null 2>&1; then echo "=== CONTAINERS ==="; docker ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}"; echo ""; echo "=== DOCKER SYSTEM DF ==="; docker system df; else echo "Docker não instalado neste servidor."; fi',
  },
  {
    id: 'pkg_updates',
    title: 'Pacotes Pendentes de Atualização',
    desc: 'Consulta pacotes que possuem atualização disponível (apt, dnf ou apk) sem instalar nada.',
    category: 'Sistema',
    risk: 'low',
    commandPreview: 'apt list --upgradable | dnf check-update | apk version',
    command:
      'LC_ALL=C; if command -v apt >/dev/null 2>&1; then apt list --upgradable 2>/dev/null; elif command -v dnf >/dev/null 2>&1; then dnf check-update -q 2>/dev/null || true; elif command -v apk >/dev/null 2>&1; then apk version -l "<" 2>/dev/null; else echo "Gerenciador de pacotes não identificado."; fi',
  },
  {
    id: 'who_logins',
    title: 'Sessões SSH Ativas & Últimos Logins',
    desc: 'Mostra usuários conectados neste instante (w) e histórico recente de logins.',
    category: 'Segurança',
    risk: 'low',
    commandPreview: 'w && last -n 15',
    command:
      'LC_ALL=C; echo "=== SESSÕES ATIVAS (w) ==="; w 2>/dev/null || who; echo ""; echo "=== ÚLTIMOS LOGINS ==="; last -n 15 2>/dev/null || echo "Comando last indisponível"',
  },
  {
    id: 'sync_fs',
    title: 'Sincronizar Buffers de Disco (sync)',
    desc: 'Força a gravação imediata de buffers pendentes em memória para os discos.',
    category: 'Manutenção',
    risk: 'medium',
    commandPreview: 'sync',
    command: 'LC_ALL=C; sync && echo "Buffers sincronizados com sucesso em $(date -Is)"',
  },
  {
    id: 'reboot_host',
    title: 'Reiniciar Servidor Remoto',
    desc: 'Agenda reinicialização do servidor em 1 minuto (shutdown -r +1). Exige confirmação forte.',
    category: 'Manutenção',
    risk: 'high',
    commandPreview: 'sudo -n shutdown -r +1',
    command:
      'LC_ALL=C; (sudo -n shutdown -r +1 "Reinicializacao solicitada via Linux Resource" 2>&1 || shutdown -r +1 "Reinicializacao solicitada via Linux Resource" 2>&1)',
  },
];

export function listRunbooks() {
  return RUNBOOKS.map(({ id, title, desc, category, risk, commandPreview }) => ({
    id,
    title,
    desc,
    category,
    risk,
    commandPreview,
  }));
}

/* ------------------------------- validation ------------------------------ */

const HOST_RE = /^[A-Za-z0-9._:-]+$/;
const USER_RE = /^[A-Za-z0-9._-]{1,32}$/;

export function validateTarget({ host, port, username, authType }) {
  const system = authType === 'system';
  const h = String(host ?? '').trim();
  if (!h || h.length > 255 || h.startsWith('-') || !HOST_RE.test(h)) return 'host inválido';
  const p = Number(port);
  if (!Number.isInteger(p) || p < (system ? 0 : 1) || p > 65535) return 'porta inválida';
  if (system) {
    if (username && !USER_RE.test(String(username))) return 'usuário inválido';
  } else if (!USER_RE.test(String(username ?? ''))) {
    return 'usuário inválido';
  }
  return null;
}

export function validateServer(input, { requireSecret = true } = {}) {
  const name = String(input?.name ?? '').trim();
  if (name.length < 1 || name.length > 60) return { error: 'o nome precisa ter de 1 a 60 caracteres' };
  const authType = input?.authType === 'password' ? 'password' : input?.authType === 'system' ? 'system' : 'key';
  const targetError = validateTarget({ ...input, authType });
  if (targetError) return { error: targetError };
  const secret = input?.secret == null ? '' : String(input.secret).trim();
  if (requireSecret && authType !== 'system' && !secret) {
    return { error: authType === 'password' ? 'informe a senha' : 'informe o caminho da chave privada' };
  }
  if (authType === 'key' && secret.includes('\n')) return { error: 'caminho de chave inválido' };
  return {
    value: {
      name,
      host: String(input.host).trim(),
      port: Number(input.port) || 0,
      username: String(input.username ?? '').trim(),
      authType,
      secret,
    },
  };
}

/* ----------------------- error classification & hostkey ------------------- */

export function classifySshError(r) {
  if (r.code === 'ENOENT') {
    return {
      error: 'binário ssh/sshpass não encontrado no host',
      errorKind: 'binary',
      errorHint: 'Instale openssh-client e sshpass no host/container do painel.',
    };
  }

  const raw = `${r.stderr || ''}\n${r.error || ''}`;
  const lines = `${r.stderr || ''}`
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] || (r.error || 'falha na conexão').split('\n')[0];

  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|Offending .* key/i.test(raw)) {
    return {
      error: 'Chave do host (Host Key) foi alterada ou é inválida',
      errorKind: 'host_key',
      errorHint:
        'A impressão digital SSH do servidor mudou (comum após reinstalar o SO). Verifique se a mudança é legítima e aceite a nova chave.',
    };
  }
  if (/Could not resolve hostname|Name or service not known|Temporary failure in name resolution/i.test(raw)) {
    return {
      error: `Falha de DNS ao resolver o host (${last})`,
      errorKind: 'dns',
      errorHint: 'Verifique se o endereço DNS/hostname está correto ou use o IP diretamente.',
    };
  }
  if (/Connection refused/i.test(raw)) {
    return {
      error: 'Conexão recusada na porta SSH',
      errorKind: 'refused',
      errorHint: 'O host respondeu, mas a porta SSH está fechada ou o serviço sshd não está rodando.',
    };
  }
  if (/No route to host|Network is unreachable|Host is down/i.test(raw)) {
    return {
      error: 'Host ou rede inacessível (sem rota)',
      errorKind: 'unreachable',
      errorHint: 'O servidor está desligado, em outra sub-rede/VPN ou sem rota de rede.',
    };
  }
  if (/Connection timed out|Operation timed out|timed out|ETIMEDOUT/i.test(raw) || r.killed) {
    return {
      error: 'Tempo limite esgotado (Timeout)',
      errorKind: 'timeout',
      errorHint: 'O servidor não respondeu dentro do tempo limite. Verifique firewall, Security Group ou VPN.',
    };
  }
  if (/UNPROTECTED PRIVATE KEY FILE|bad permissions/i.test(raw)) {
    return {
      error: 'Permissões da chave privada inseguras',
      errorKind: 'key_file',
      errorHint: 'Ajuste a permissão do arquivo de chave privada com: chmod 600 <caminho-da-chave>.',
    };
  }
  if (/Identity file .* not accessible|No such file or directory/i.test(raw)) {
    return {
      error: 'Arquivo de chave privada não encontrado',
      errorKind: 'key_file',
      errorHint: 'Verifique se o caminho da chave privada existe e está acessível pelo painel.',
    };
  }
  if (/Permission denied|Authentication failed|invalid format/i.test(raw)) {
    return {
      error: 'Autenticação SSH recusada pelo servidor',
      errorKind: 'auth',
      errorHint: 'Verifique o usuário SSH, a senha ou se a chave pública está autorizada em ~/.ssh/authorized_keys.',
    };
  }

  return {
    error: last,
    errorKind: 'unknown',
    errorHint: 'Verifique a conectividade SSH e as credenciais configuradas.',
  };
}

function hostTokensForServer(server) {
  const h = String(server.host || '').trim().toLowerCase();
  const p = Number(server.port) || 22;
  const tokens = new Set([h, `[${h}]:${p}`]);
  return tokens;
}

export function getHostKeyInfo(server) {
  try {
    if (!existsSync(KNOWN_HOSTS)) return { known: false, keyType: null, fingerprint: null };
    const content = readFileSync(KNOWN_HOSTS, 'utf8');
    const targets = hostTokensForServer(server);

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;
      const hostsField = parts[0].toLowerCase().split(',');
      if (hostsField.some((tok) => targets.has(tok))) {
        const keyType = parts[1];
        const keyBase64 = parts[2];
        const digest = createHash('sha256')
          .update(Buffer.from(keyBase64, 'base64'))
          .digest('base64')
          .replace(/=+$/, '');
        return {
          known: true,
          keyType,
          fingerprint: `SHA256:${digest}`,
        };
      }
    }
  } catch {
    /* ignore known_hosts read error */
  }
  return { known: false, keyType: null, fingerprint: null };
}

export function resetHostKey(server) {
  try {
    if (!existsSync(KNOWN_HOSTS)) return { removed: 0 };
    const content = readFileSync(KNOWN_HOSTS, 'utf8');
    const targets = hostTokensForServer(server);
    let removed = 0;
    const kept = [];

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        if (rawLine) kept.push(rawLine);
        continue;
      }
      const parts = line.split(/\s+/);
      if (parts.length >= 3) {
        const hostsField = parts[0].toLowerCase().split(',');
        if (hostsField.some((tok) => targets.has(tok))) {
          removed++;
          continue;
        }
      }
      kept.push(rawLine);
    }

    writeFileSync(KNOWN_HOSTS, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
    invalidateServer(server.id);
    return { removed };
  } catch (err) {
    throw new Error(`Falha ao limpar chave em known_hosts: ${err.message}`);
  }
}

/* -------------------------------- executor ------------------------------- */

function execSshCommand(server, secret, remoteCommand, timeoutSec = SSH_COMMAND_TIMEOUT) {
  const mode = server.authType === 'password' ? 'password' : server.authType === 'system' ? 'system' : 'key';
  const args = [
    '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${KNOWN_HOSTS}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'LogLevel=ERROR',
  ];
  if (server.port) args.push('-p', String(server.port));
  const target = server.username ? `${server.username}@${server.host}` : server.host;

  if (mode === 'password') {
    args.push('-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password', '-o', 'NumberOfPasswordPrompts=1', target, remoteCommand);
  } else if (mode === 'key') {
    args.push('-o', 'BatchMode=yes', '-o', 'PreferredAuthentications=publickey', '-i', secret, target, remoteCommand);
  } else {
    args.push('-o', 'BatchMode=yes', target, remoteCommand);
  }

  const file = mode === 'password' ? SSHPASS_BIN : SSH_BIN;
  const finalArgs = mode === 'password' ? ['-e', SSH_BIN, ...args] : args;
  const env = mode === 'password' ? { ...process.env, SSHPASS: secret } : process.env;

  return new Promise((resolve) => {
    execFile(
      file,
      finalArgs,
      { timeout: (timeoutSec + SSH_CONNECT_TIMEOUT) * 1000, maxBuffer: 4 * 1024 * 1024, env },
      (err, stdout, stderr) => {
        if (mode === 'password' && err?.code === 'ENOENT') {
          return resolve({ ok: false, code: 'ENOENT', stdout: '', stderr: 'sshpass ausente', error: 'sshpass não instalado' });
        }
        resolve({
          ok: !err,
          killed: !!err?.killed,
          code: typeof err?.code === 'number' ? err.code : err?.code ?? (err ? 1 : 0),
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          error: err ? String(err.message || err) : null,
        });
      },
    );
  });
}

/* ----------------------------- ~/.ssh/config ----------------------------- */

export function readSshConfig() {
  let text;
  try {
    text = readFileSync(SSH_CONFIG_FILE, 'utf8');
  } catch {
    return { file: SSH_CONFIG_FILE, exists: false, hosts: [] };
  }

  const blocks = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.aliases.length) blocks.push(cur);
    cur = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z]+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'host') {
      flush();
      const aliases = val.split(/\s+/).filter((a) => a && !/[*?!]/.test(a));
      cur = { aliases, hostName: null, user: null, port: null, identityFile: null, proxyJump: null };
      if (!aliases.length) cur = null;
    } else if (cur) {
      if (key === 'hostname') cur.hostName = val;
      else if (key === 'user') cur.user = val;
      else if (key === 'port') cur.port = Number(val) || null;
      else if (key === 'identityfile') cur.identityFile = val;
      else if (key === 'proxyjump') cur.proxyJump = val;
    }
  }
  flush();

  const hosts = [];
  for (const b of blocks) {
    for (const alias of b.aliases) {
      hosts.push({
        alias,
        hostName: b.hostName,
        user: b.user,
        port: b.port,
        identityFile: b.identityFile,
        proxyJump: b.proxyJump,
      });
    }
  }
  hosts.sort((a, b) => a.alias.localeCompare(b.alias));
  return { file: SSH_CONFIG_FILE, exists: true, hosts };
}

/* -------------------------------- parsing -------------------------------- */

function parseSections(text) {
  const out = {};
  let cur = null;
  for (const line of String(text).split('\n')) {
    const m = line.match(/^@@([A-Z0-9_]+)\s*$/);
    if (m) {
      cur = m[1];
      out[cur] = [];
      continue;
    }
    if (cur) out[cur].push(line);
  }
  return out;
}

function first(lines) {
  return (lines || []).map((l) => l.trim()).find(Boolean) ?? null;
}

function parseCpu(stat1, stat2) {
  const parse = (line) => {
    const parts = String(line || '').trim().split(/\s+/).slice(1).map(Number);
    const idle = (parts[3] || 0) + (parts[4] || 0);
    const total = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    return { idle, total };
  };
  const a = parse(first(stat1));
  const b = parse(first(stat2));
  const dt = b.total - a.total;
  if (dt <= 0) return 0;
  return Math.max(0, Math.min(100, ((dt - (b.idle - a.idle)) / dt) * 100));
}

function parseMem(lines) {
  const m = {};
  for (const l of lines || []) {
    const mm = l.match(/^(\w+):\s+(\d+)/);
    if (mm) m[mm[1]] = Number(mm[2]) * 1024;
  }
  const total = m.MemTotal || 0;
  const available = m.MemAvailable ?? m.MemFree ?? 0;
  const used = Math.max(0, total - available);
  const swapTotal = m.SwapTotal || 0;
  const swapFree = m.SwapFree || 0;
  return {
    total,
    used,
    free: m.MemFree || 0,
    available,
    buffers: m.Buffers || 0,
    cached: (m.Cached || 0) + (m.SReclaimable || 0),
    swapTotal,
    swapUsed: Math.max(0, swapTotal - swapFree),
    memPct: total ? (used / total) * 100 : 0,
  };
}

function parseDisks(lines) {
  const out = [];
  const header = first(lines) || '';
  const hasType = /\bType\b/i.test(header);

  for (const l of (lines || []).slice(1)) {
    const t = l.trim();
    if (!t || t.startsWith('Filesystem')) continue;
    const parts = t.split(/\s+/);
    if (parts.length < (hasType ? 7 : 6)) continue;

    let fs, fstype, blocks, used, avail, pct, mountParts;
    if (hasType) {
      [fs, fstype, blocks, used, avail, pct, ...mountParts] = parts;
    } else {
      [fs, blocks, used, avail, pct, ...mountParts] = parts;
      fstype = null;
    }

    if (PSEUDO_FS.test(fs) || (fstype && PSEUDO_FS.test(fstype))) continue;
    const mount = mountParts.join(' ');
    if (mount.startsWith('/snap/') || mount.startsWith('/run/') || mount.startsWith('/sys/') || mount.startsWith('/proc')) continue;

    const total = Number(blocks) * 1024;
    if (!Number.isFinite(total) || total <= 0) continue;
    out.push({
      fs,
      fstype,
      mount,
      total,
      used: Number(used) * 1024,
      avail: Number(avail) * 1024,
      usedPct: Number.parseFloat(pct) || 0,
    });
  }
  return out;
}

function parseIps(lines) {
  const map = new Map();
  for (const l of lines || []) {
    const parts = l.trim().split(/\s+/);
    if (parts.length >= 2) {
      const iface = parts[0];
      const cidr = parts[1];
      const ip = cidr.split('/')[0];
      if (iface && ip && !map.has(iface)) map.set(iface, ip);
    }
  }
  return map;
}

function parseNet(lines, ipLines) {
  const ipMap = parseIps(ipLines);
  const ifaces = [];
  for (const l of (lines || []).slice(2)) {
    const t = l.trim();
    const idx = t.indexOf(':');
    if (!t || idx < 0) continue;
    const name = t.slice(0, idx).trim();
    if (!name) continue;
    const f = t.slice(idx + 1).trim().split(/\s+/).map(Number);
    ifaces.push({
      name,
      ipv4: ipMap.get(name) || null,
      rx: f[0] || 0,
      rxErrs: (f[2] || 0) + (f[3] || 0),
      tx: f[8] || 0,
      txErrs: (f[10] || 0) + (f[11] || 0),
    });
  }
  return ifaces;
}

function parseProcs(lines) {
  const out = [];
  for (const l of (lines || []).slice(1)) {
    const t = l.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 6) continue;
    const pid = Number(parts[0]);
    if (!Number.isFinite(pid)) continue;
    const user = parts[1];
    const cpu = Number.parseFloat(parts[2]) || 0;
    const memPct = Number.parseFloat(parts[3]) || 0;
    const rssBytes = (Number.parseInt(parts[4], 10) || 0) * 1024;
    const name = parts.slice(5).join(' ');
    out.push({ pid, user, cpu, memPct, mem: rssBytes, name });
  }
  return out;
}

function primaryDisk(disks) {
  if (!disks.length) return null;
  return disks.find((d) => d.mount === '/') ?? [...disks].sort((a, b) => b.total - a.total)[0];
}

/* --------------------------------- cache --------------------------------- */

const cache = new Map();

function buildSnapshot(server, parsed) {
  const now = Date.now();
  const prev = cache.get(server.id);
  const prevRates = prev?.rates ?? null;
  const prevTs = prev?.ts ?? null;
  const dt = prevTs ? Math.max(0.001, (now - prevTs) / 1000) : 0;

  const raw = parseNet(parsed.NET, parsed.IP);
  const rates = {};
  const interfaces = raw.map((i) => {
    const before = prevRates?.[i.name];
    const rxRate = dt && before ? Math.round(Math.max(0, (i.rx - before.rx) / dt)) : 0;
    const txRate = dt && before ? Math.round(Math.max(0, (i.tx - before.tx) / dt)) : 0;
    rates[i.name] = { rx: i.rx, tx: i.tx };
    return {
      name: i.name,
      ipv4: i.ipv4,
      rx: i.rx,
      tx: i.tx,
      rxRate,
      txRate,
      rxErrs: i.rxErrs,
      txErrs: i.txErrs,
      virtual: VIRTUAL_IFACE.test(i.name),
    };
  });

  const active = interfaces.filter((i) => !i.virtual);
  const network = {
    rxRate: active.reduce((a, i) => a + i.rxRate, 0),
    txRate: active.reduce((a, i) => a + i.txRate, 0),
    rxTotal: active.reduce((a, i) => a + i.rx, 0),
    txTotal: active.reduce((a, i) => a + i.tx, 0),
    interfaces,
  };

  const disks = parseDisks(parsed.DF);
  const ncpu = Number.parseInt(first(parsed.NCPU) ?? '', 10);
  const loadParts = (first(parsed.LOAD) ?? '').split(/\s+/).slice(0, 3).map(Number);
  const uptime = Number.parseFloat(first(parsed.UPTIME) ?? '') || null;
  const hostKey = getHostKeyInfo(server);

  const snapshot = {
    id: server.id,
    online: true,
    ts: now,
    error: null,
    errorKind: null,
    errorHint: null,
    failCount: 0,
    backoffUntil: null,
    hostKey,
    lastSeen: now,
    uname: first(parsed.UNAME),
    osName: first(parsed.OS),
    cpuModel: first(parsed.CPU_MODEL),
    hostname: first(parsed.HOST),
    ncpu: Number.isFinite(ncpu) ? ncpu : null,
    uptime,
    loadavg: loadParts.length === 3 && loadParts.every(Number.isFinite) ? loadParts : null,
    cpuUsage: parseCpu(parsed.STAT1, parsed.STAT2),
    memory: parseMem(parsed.MEM),
    disks,
    primaryDisk: primaryDisk(disks),
    network,
    processes: parseProcs(parsed.PROCS),
    collectMs: null,
  };

  return { snapshot, rates };
}

/* --------------------------------- public -------------------------------- */

function resolveSecret(server) {
  if (server.authType === 'system') return { ok: true, secret: null };
  try {
    const secret = decryptSecret(server.secretEnc);
    if (!secret) return { ok: false, error: 'credencial não configurada', errorKind: 'auth', errorHint: 'Edite o servidor e informe a chave ou senha.' };
    return { ok: true, secret };
  } catch (err) {
    return { ok: false, error: `segredo inválido: ${err.message}`, errorKind: 'auth', errorHint: 'Reconfigure a credencial do servidor.' };
  }
}

export async function collectServer(server, { force = false } = {}) {
  const now = Date.now();
  const hit = cache.get(server.id);

  // Backoff automático para servidores que falham repetidamente (exceto quando force = true)
  if (!force && hit) {
    if (hit.backoffUntil && now < hit.backoffUntil) {
      return hit.snapshot;
    }
    if (now - hit.ts < SSH_CACHE_MS) {
      return hit.snapshot;
    }
  }

  const hostKey = getHostKeyInfo(server);
  const cred = resolveSecret(server);
  if (!cred.ok) {
    const snapshot = {
      id: server.id,
      online: false,
      ts: now,
      error: cred.error,
      errorKind: cred.errorKind,
      errorHint: cred.errorHint,
      failCount: (hit?.failCount || 0) + 1,
      backoffUntil: null,
      hostKey,
      lastSeen: hit?.snapshot?.lastSeen ?? null,
    };
    cache.set(server.id, { ts: now, rates: hit?.rates ?? null, failCount: snapshot.failCount, backoffUntil: null, snapshot });
    return snapshot;
  }

  const started = Date.now();
  const r = await execSshCommand(server, cred.secret, REMOTE_CMD);
  if (!r.ok) {
    const classified = classifySshError(r);
    const failCount = (hit?.failCount || 0) + 1;
    // Backoff exponencial a partir da 2ª falha seguida: 12s, 24s, 48s, máx 120s
    const delayMs = failCount >= 2 ? Math.min(120_000, 6_000 * Math.pow(2, Math.min(failCount - 1, 5))) : 0;
    const backoffUntil = delayMs ? Date.now() + delayMs : null;

    const snapshot = {
      id: server.id,
      online: false,
      ts: now,
      error: classified.error,
      errorKind: classified.errorKind,
      errorHint: classified.errorHint,
      failCount,
      backoffUntil,
      hostKey: getHostKeyInfo(server),
      lastSeen: hit?.snapshot?.lastSeen ?? null,
    };
    cache.set(server.id, { ts: now, rates: hit?.rates ?? null, failCount, backoffUntil, snapshot });
    return snapshot;
  }

  const parsed = parseSections(r.stdout);
  const { snapshot, rates } = buildSnapshot(server, parsed);
  snapshot.collectMs = Date.now() - started;
  cache.set(server.id, { ts: Date.now(), rates, failCount: 0, backoffUntil: null, snapshot });
  recordSshHistory(server.id, snapshot);
  return snapshot;
}

export async function execRunbook(server, runbookId) {
  const rb = RUNBOOKS.find((x) => x.id === runbookId);
  if (!rb) return { ok: false, error: 'runbook não encontrado' };

  const cred = resolveSecret(server);
  if (!cred.ok) {
    return {
      ok: false,
      code: 1,
      stdout: '',
      stderr: '',
      durationMs: 0,
      error: cred.error,
      errorKind: cred.errorKind,
      errorHint: cred.errorHint,
      runbook: { id: rb.id, title: rb.title, commandPreview: rb.commandPreview },
    };
  }

  const started = Date.now();
  const r = await execSshCommand(server, cred.secret, rb.command, Math.max(15, SSH_COMMAND_TIMEOUT * 2));
  const durationMs = Date.now() - started;
  const classified = r.ok ? null : classifySshError(r);

  return {
    ok: r.ok,
    code: r.code,
    stdout: r.stdout,
    stderr: r.stderr,
    durationMs,
    error: classified?.error ?? null,
    errorKind: classified?.errorKind ?? null,
    errorHint: classified?.errorHint ?? null,
    runbook: { id: rb.id, title: rb.title, commandPreview: rb.commandPreview },
  };
}

export async function collectAll(servers, opts = {}) {
  const queue = [...servers];
  const results = [];
  const workers = Array.from({ length: Math.min(Math.max(1, SSH_CONCURRENCY), queue.length || 1) }, async () => {
    while (queue.length) {
      const s = queue.shift();
      results.push(await collectServer(s, opts));
    }
  });
  await Promise.all(workers);
  return results;
}

export function invalidateServer(id) {
  cache.delete(id);
}

export function cacheSize() {
  return cache.size;
}
