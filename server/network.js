import { execFile } from 'node:child_process';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import { PING_BIN, SCAN_ROOT } from './config.js';

const IS_HOST_MOUNT = Boolean(SCAN_ROOT && SCAN_ROOT !== '/');

function procNetFile(name) {
  const pid1 = `/proc/1/net/${name}`;
  if (existsSync(pid1)) return pid1;
  return `/proc/net/${name}`;
}

function sysNetFile(iface, attr) {
  if (IS_HOST_MOUNT) {
    const hp = `${SCAN_ROOT.replace(/\/+$/, '')}/sys/class/net/${iface}/${attr}`;
    if (existsSync(hp)) return hp;
  }
  return `/sys/class/net/${iface}/${attr}`;
}

function exec(bin, args, { timeout = 4000 } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? 1 : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export async function readNetDev() {
  const out = {};
  let txt;
  try {
    txt = await fsp.readFile(procNetFile('dev'), 'utf8');
  } catch {
    return out;
  }
  for (const raw of txt.split('\n').slice(2)) {
    const line = raw.trim();
    if (!line || !line.includes(':')) continue;
    const [namePart, rest] = line.split(':');
    const name = namePart.trim();
    const n = rest.trim().split(/\s+/).map(Number);
    out[name] = {
      rx: n[0] || 0,
      rxPackets: n[1] || 0,
      rxErrs: n[2] || 0,
      rxDrop: n[3] || 0,
      tx: n[8] || 0,
      txPackets: n[9] || 0,
      txErrs: n[10] || 0,
      txDrop: n[11] || 0,
    };
  }
  return out;
}

async function readSysFile(p) {
  try {
    return (await fsp.readFile(p, 'utf8')).trim();
  } catch {
    return null;
  }
}

export function isVirtualIface(name) {
  return /^(lo$|veth|br-|docker|virbr|tun|tap|cali|flannel|cni)/i.test(name);
}

function ifacePriority(item) {
  if (item.internal || item.name === 'lo') return 90;
  if (isVirtualIface(item.name)) return 70;
  const isPhysicalLan = /^(en|eth|wl|ww|bond)/i.test(item.name);
  if (isPhysicalLan && item.ipv4 && item.operstate === 'up') return 10;
  if (isPhysicalLan && item.ipv4) return 20;
  if (item.ipv4) return 30;
  if (isPhysicalLan) return 40;
  return 50;
}

export async function getInterfaces() {
  const ni = os.networkInterfaces();
  const dev = await readNetDev();
  const names = new Set([...Object.keys(ni), ...Object.keys(dev)]);
  const out = [];

  for (const name of names) {
    const addrs = ni[name] || [];
    const v4 = addrs.find((a) => a.family === 'IPv4' && !a.internal) || addrs.find((a) => a.family === 'IPv4');
    const v6 = addrs.find((a) => a.family === 'IPv6' && !a.internal) || addrs.find((a) => a.family === 'IPv6');
    const speedRaw = await readSysFile(sysNetFile(name, 'speed'));
    const speed = speedRaw && Number(speedRaw) > 0 ? Number(speedRaw) : null;
    const operstate = await readSysFile(sysNetFile(name, 'operstate'));
    const sysMac = await readSysFile(sysNetFile(name, 'address'));
    const macCandidate = v4?.mac && v4.mac !== '00:00:00:00:00:00' ? v4.mac : addrs[0]?.mac || sysMac || null;

    out.push({
      name,
      mac: macCandidate && macCandidate !== '00:00:00:00:00:00' ? macCandidate : null,
      ipv4: v4?.address || null,
      cidr: v4?.cidr || null,
      ipv6: v6?.address || null,
      internal: name === 'lo' || !!v4?.internal,
      speed,
      operstate,
      rxTotal: dev[name]?.rx ?? 0,
      txTotal: dev[name]?.tx ?? 0,
      rxErrs: dev[name]?.rxErrs ?? 0,
      txErrs: dev[name]?.txErrs ?? 0,
      rxDrop: dev[name]?.rxDrop ?? 0,
      txDrop: dev[name]?.txDrop ?? 0,
    });
  }
  out.sort((a, b) => ifacePriority(a) - ifacePriority(b) || a.name.localeCompare(b.name));
  return out;
}

const TCP_STATES = {
  '01': 'ESTABLISHED',
  '02': 'SYN_SENT',
  '03': 'SYN_RECV',
  '04': 'FIN_WAIT1',
  '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT',
  '07': 'CLOSE',
  '08': 'CLOSE_WAIT',
  '09': 'LAST_ACK',
  '0A': 'LISTEN',
  '0B': 'CLOSING',
  '0C': 'NEW_SYN_RECV',
};

export async function getTcpStates() {
  const counts = {};
  const listen = new Set();
  for (const file of [procNetFile('tcp'), procNetFile('tcp6')]) {
    let txt;
    try {
      txt = await fsp.readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of txt.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 4) continue;
      const st = f[3];
      const name = TCP_STATES[st] || st;
      counts[name] = (counts[name] || 0) + 1;
      if (st === '0A' && f[1]) {
        const port = parseInt(f[1].split(':')[1], 16);
        if (Number.isFinite(port)) listen.add(port);
      }
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, listen: [...listen].sort((a, b) => a - b), total };
}

let latencyCache = { ts: 0, ms: null, host: null };

function hexToIpv4(h) {
  const b = [];
  for (let i = 0; i < 8; i += 2) b.push(parseInt(h.slice(i, i + 2), 16));
  return b.reverse().join('.');
}

function hexToIpv6(h) {
  const groups = [];
  for (let i = 0; i < 32; i += 8) {
    const g = h.slice(i, i + 8);
    const bytes = [];
    for (let j = 0; j < 8; j += 2) bytes.push(g.slice(j, j + 2));
    groups.push(bytes.reverse().join(''));
  }
  const full = groups.join('');
  const parts = full.match(/.{1,4}/g) || [];
  const v4mapped = /^0000:0000:0000:0000:0000:ffff:(.+)$/.test(parts.join(':'));
  if (v4mapped) {
    const tail = parts.join(':').split(':').slice(6).join('');
    return `::ffff:${hexToIpv4(tail)}`;
  }
  return parts.join(':');
}

function decodeAddr(hex, ipv6) {
  const [addr, port] = hex.split(':');
  const ip = ipv6 ? hexToIpv6(addr) : hexToIpv4(addr);
  return { ip, port: parseInt(port, 16) };
}

export async function getConnections({ limit = 300 } = {}) {
  const rows = [];
  for (const [file, ipv6] of [[procNetFile('tcp'), false], [procNetFile('tcp6'), true]]) {
    let txt;
    try {
      txt = await fsp.readFile(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of txt.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 10) continue;
      const st = TCP_STATES[f[3]] || f[3];
      const local = decodeAddr(f[1], ipv6);
      const remote = decodeAddr(f[2], ipv6);
      rows.push({
        proto: ipv6 ? 'tcp6' : 'tcp',
        state: st,
        localIp: local.ip,
        localPort: local.port,
        remoteIp: remote.ip,
        remotePort: remote.port,
        uid: Number(f[7]) || 0,
        inode: f[9],
      });
    }
  }
  const rank = { ESTABLISHED: 0, SYN_SENT: 1, SYN_RECV: 2, LISTEN: 9 };
  rows.sort(
    (a, b) =>
      (rank[a.state] ?? 5) - (rank[b.state] ?? 5) ||
      a.localPort - b.localPort ||
      a.remoteIp.localeCompare(b.remoteIp),
  );
  const counts = {};
  for (const r of rows) counts[r.state] = (counts[r.state] || 0) + 1;
  return { total: rows.length, counts, connections: rows.slice(0, limit) };
}

export async function getLatency(host = '1.1.1.1') {
  if (latencyCache.host === host && Date.now() - latencyCache.ts < 5000) return latencyCache.ms;
  const r = await exec(PING_BIN, ['-n', '-c', '1', '-W', '1', host]);
  const m = r.stdout.match(/time[=<]([\d.]+)/);
  const ms = m ? Number(m[1]) : null;
  latencyCache = { ts: Date.now(), ms, host };
  return ms;
}
