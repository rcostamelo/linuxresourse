import { execFile } from 'node:child_process';
import { promises as fsp, existsSync } from 'node:fs';
import path from 'node:path';
import { SCAN_ROOT } from './config.js';

const MIB = 1024 * 1024;
const PCI_CACHE_TTL = 5 * 60 * 1000;
const PMON_CACHE_TTL = 4000;

let pciNamesCache = { ts: 0, bySlot: new Map() };
let pmonCache = { ts: 0, byIdx: new Map() };

function runCmd(bin, args, timeout = 3500) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

async function runNvidiaSmi(args, timeout = 3000) {
  const direct = await runCmd('nvidia-smi', args, timeout);
  if (direct.ok && direct.stdout.trim()) return direct;

  if (SCAN_ROOT) {
    const hostBins = [
      `${SCAN_ROOT}/usr/bin/nvidia-smi`,
      `${SCAN_ROOT}/bin/nvidia-smi`,
      `${SCAN_ROOT}/usr/local/bin/nvidia-smi`,
    ];
    const hostBin = hostBins.find((p) => existsSync(p));
    if (hostBin) {
      const loaders = [
        `${SCAN_ROOT}/lib64/ld-linux-x86-64.so.2`,
        `${SCAN_ROOT}/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2`,
        `${SCAN_ROOT}/usr/lib64/ld-linux-x86-64.so.2`,
        `${SCAN_ROOT}/lib/ld-linux-aarch64.so.1`,
        `${SCAN_ROOT}/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1`,
      ];
      const loader = loaders.find((p) => existsSync(p));
      if (loader) {
        const libDirs = [
          `${SCAN_ROOT}/lib/x86_64-linux-gnu`,
          `${SCAN_ROOT}/usr/lib/x86_64-linux-gnu`,
          `${SCAN_ROOT}/usr/lib64`,
          `${SCAN_ROOT}/lib64`,
          `${SCAN_ROOT}/usr/lib`,
          `${SCAN_ROOT}/lib`,
          `${SCAN_ROOT}/lib/aarch64-linux-gnu`,
          `${SCAN_ROOT}/usr/lib/aarch64-linux-gnu`,
        ].filter((d) => existsSync(d));
        return runCmd(loader, ['--library-path', libDirs.join(':'), hostBin, ...args], timeout);
      }
    }
  }
  return direct;
}

export function normalizeBusId(raw) {
  if (!raw) return null;
  const clean = String(raw).trim().toLowerCase();
  if (!clean) return null;
  // Converte 00000000:01:00.0 ou 0000:01:00.0 para 01:00.0
  return clean.replace(/^[0-9a-f]{4,8}:/, '');
}

function parseNum(val) {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (!s || s === 'N/A' || s === '[N/A]' || s === '[Not Supported]' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function readTextSafe(filePath) {
  try {
    return (await fsp.readFile(filePath, 'utf8')).trim();
  } catch {
    return null;
  }
}

async function readIntSafe(filePath) {
  const txt = await readTextSafe(filePath);
  if (txt == null) return null;
  const n = Number(txt);
  return Number.isFinite(n) ? n : null;
}

function vendorFromHex(hex) {
  const v = String(hex || '').trim().toLowerCase();
  if (v === '0x10de' || v === '10de') return 'NVIDIA';
  if (v === '0x1002' || v === '1002' || v === '0x1022') return 'AMD';
  if (v === '0x8086' || v === '8086') return 'Intel';
  if (v === '0x1a03' || v === '1a03') return 'ASPEED';
  if (v === '0x1af4' || v === '1af4' || v === '0x1234' || v === '0x15ad') return 'Virtual';
  return 'GPU';
}

async function loadPciGpuNames() {
  if (Date.now() - pciNamesCache.ts < PCI_CACHE_TTL && pciNamesCache.bySlot.size > 0) {
    return pciNamesCache.bySlot;
  }
  const bySlot = new Map();
  const r = await runCmd('lspci', ['-D'], 2500);
  if (r.ok && r.stdout) {
    for (const line of r.stdout.split('\n')) {
      if (!/(VGA compatible controller|3D controller|Display controller)/i.test(line)) continue;
      const m = line.match(/^([0-9a-fA-F:.]+)\s+[^:]+:\s+(.+)$/);
      if (!m) continue;
      const slot = normalizeBusId(m[1]);
      let model = m[2].replace(/\s*\(rev\s+[0-9a-f]+\)\s*$/i, '').trim();
      const bracket = model.match(/\[([^\]]+)\]/g);
      if (bracket && bracket.length > 0) {
        const lastBracket = bracket[bracket.length - 1].slice(1, -1).trim();
        if (/NVIDIA|GeForce|RTX|GTX|Quadro|Tesla|Radeon|Instinct|Arc|Iris|UHD|HD Graphics/i.test(lastBracket)) {
          const vendorPrefix =
            /NVIDIA/i.test(model) && !/NVIDIA/i.test(lastBracket)
              ? 'NVIDIA '
              : /AMD|ATI/i.test(model) && !/AMD|Radeon/i.test(lastBracket)
                ? 'AMD '
                : /Intel/i.test(model) && !/Intel/i.test(lastBracket)
                  ? 'Intel '
                  : '';
          model = `${vendorPrefix}${lastBracket}`;
        }
      }
      if (slot && model) bySlot.set(slot, model);
    }
  }
  pciNamesCache = { ts: Date.now(), bySlot };
  return bySlot;
}

async function queryNvidiaProcesses(uuidsByIndex) {
  if (Date.now() - pmonCache.ts < PMON_CACHE_TTL && pmonCache.byIdx.size > 0) {
    return pmonCache.byIdx;
  }

  const byIdx = new Map();
  const pmon = await runNvidiaSmi(['pmon', '-c', '1', '-s', 'um'], 2500);
  if (pmon.ok && pmon.stdout) {
    let headerCols = null;
    for (const rawLine of pmon.stdout.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        const tokens = line.replace(/^#\s*/, '').trim().split(/\s+/);
        if (tokens.includes('gpu') && tokens.includes('pid')) {
          headerCols = tokens;
        }
        continue;
      }
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;

      const cols = headerCols || ['gpu', 'pid', 'type', 'sm', 'mem', 'enc', 'dec', 'jpg', 'ofa', 'fb', 'ccpm', 'command'];
      const cmdIdx = Math.max(5, cols.indexOf('command'));
      const getCol = (name) => {
        const idx = cols.indexOf(name);
        return idx >= 0 && idx < parts.length ? parts[idx] : null;
      };

      const gpuIdx = Number(getCol('gpu') ?? parts[0]);
      const pid = Number(getCol('pid') ?? parts[1]);
      if (!Number.isInteger(gpuIdx) || !Number.isInteger(pid) || pid <= 0) continue;

      const rawType = getCol('type') ?? parts[2];
      const type = rawType === '-' ? 'G' : rawType;
      const smUtil = parseNum(getCol('sm'));
      const memUtil = parseNum(getCol('mem'));
      const encUtil = parseNum(getCol('enc'));
      const decUtil = parseNum(getCol('dec'));
      const fbMb = parseNum(getCol('fb')) || 0;
      const ccpmMb = parseNum(getCol('ccpm')) || 0;
      const memUsed = (fbMb + ccpmMb) * MIB;
      const name = parts.slice(cmdIdx).join(' ') || String(pid);

      if (!byIdx.has(gpuIdx)) byIdx.set(gpuIdx, []);
      byIdx.get(gpuIdx).push({
        pid,
        type,
        name,
        memUsed,
        smUtil,
        memUtil,
        encUtil,
        decUtil,
      });
    }
    for (const list of byIdx.values()) {
      list.sort((a, b) => b.memUsed - a.memUsed || (b.smUtil || 0) - (a.smUtil || 0));
    }
    pmonCache = { ts: Date.now(), byIdx };
    return byIdx;
  }

  // Fallback para compute-apps caso pmon não seja suportado
  const comp = await runNvidiaSmi(
    ['--query-compute-apps=gpu_uuid,pid,process_name,used_memory', '--format=csv,noheader,nounits'],
    2500,
  );
  if (comp.ok && comp.stdout) {
    const idxByUuid = new Map();
    for (const [idx, uuid] of uuidsByIndex.entries()) idxByUuid.set(uuid, idx);
    for (const rawLine of comp.stdout.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length < 4) continue;
      const [uuid, pidRaw, procName, memRaw] = parts;
      const gpuIdx = idxByUuid.get(uuid) ?? 0;
      const pid = Number(pidRaw);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const memUsed = (parseNum(memRaw) || 0) * MIB;
      const name = path.basename(procName || String(pid));
      if (!byIdx.has(gpuIdx)) byIdx.set(gpuIdx, []);
      byIdx.get(gpuIdx).push({
        pid,
        type: 'C',
        name,
        memUsed,
        smUtil: null,
        memUtil: null,
        encUtil: null,
        decUtil: null,
      });
    }
    pmonCache = { ts: Date.now(), byIdx };
  }
  return byIdx;
}

async function queryNvidiaSmi() {
  const fields = [
    'index',
    'uuid',
    'name',
    'driver_version',
    'vbios_version',
    'pci.bus_id',
    'pcie.link.gen.current',
    'pcie.link.gen.max',
    'pcie.link.width.current',
    'pcie.link.width.max',
    'temperature.gpu',
    'utilization.gpu',
    'utilization.memory',
    'encoder.stats.averageFps',
    'memory.total',
    'memory.used',
    'memory.free',
    'memory.reserved',
    'power.draw',
    'power.limit',
    'power.default_limit',
    'power.max_limit',
    'fan.speed',
    'clocks.current.graphics',
    'clocks.max.graphics',
    'clocks.current.sm',
    'clocks.current.memory',
    'clocks.max.memory',
    'clocks.current.video',
    'pstate',
    'display_active',
    'persistence_mode',
  ].join(',');

  const r = await runNvidiaSmi([`--query-gpu=${fields}`, '--format=csv,noheader,nounits'], 3000);
  if (!r.ok || !r.stdout.trim()) return [];

  const gpus = [];
  const uuidsByIndex = new Map();

  for (const rawLine of r.stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = line.split(',').map((s) => s.trim());
    if (cols.length < 25) continue;

    const index = parseNum(cols[0]) ?? gpus.length;
    const uuid = cols[1] || `nvidia-${index}`;
    const name = cols[2] || 'NVIDIA GPU';
    const driver = cols[3] && cols[3] !== 'N/A' ? cols[3] : null;
    const vbios = cols[4] && cols[4] !== 'N/A' ? cols[4] : null;
    const busId = normalizeBusId(cols[5]);
    const pcieGen = parseNum(cols[6]);
    const pcieGenMax = parseNum(cols[7]);
    const pcieWidth = parseNum(cols[8]);
    const pcieWidthMax = parseNum(cols[9]);
    const temperature = parseNum(cols[10]);
    const utilization = parseNum(cols[11]);
    const memUtilization = parseNum(cols[12]);
    const encoderFps = parseNum(cols[13]);
    const memTotalMib = parseNum(cols[14]);
    const memUsedMib = parseNum(cols[15]);
    const memFreeMib = parseNum(cols[16]);
    const memReservedMib = parseNum(cols[17]);
    const powerDraw = parseNum(cols[18]);
    const powerLimit = parseNum(cols[19]);
    const powerDefaultLimit = parseNum(cols[20]);
    const powerMaxLimit = parseNum(cols[21]);
    const fanSpeed = parseNum(cols[22]);
    const clockCore = parseNum(cols[23]);
    const clockCoreMax = parseNum(cols[24]);
    const clockSm = parseNum(cols[25]);
    const clockMem = parseNum(cols[26]);
    const clockMemMax = parseNum(cols[27]);
    const clockVideo = parseNum(cols[28]);
    const pstate = cols[29] && cols[29] !== 'N/A' ? cols[29] : null;
    const displayActive = cols[30] ? /^enabled$/i.test(cols[30]) : null;
    const persistenceMode = cols[31] ? /^enabled$/i.test(cols[31]) : null;

    const memTotal = memTotalMib != null ? Math.round(memTotalMib * MIB) : null;
    const memUsed = memUsedMib != null ? Math.round(memUsedMib * MIB) : null;
    const memFree =
      memFreeMib != null
        ? Math.round(memFreeMib * MIB)
        : memTotal != null && memUsed != null
          ? Math.max(0, memTotal - memUsed)
          : null;
    const memReserved = memReservedMib != null ? Math.round(memReservedMib * MIB) : null;
    const memPct = memTotal && memUsed != null ? Math.min(100, Math.max(0, (memUsed / memTotal) * 100)) : null;

    uuidsByIndex.set(index, uuid);

    gpus.push({
      index,
      id: uuid,
      name,
      vendor: 'NVIDIA',
      driver,
      vbios,
      busId,
      pcieGen,
      pcieGenMax,
      pcieWidth,
      pcieWidthMax,
      utilization,
      memUtilization,
      encoderFps,
      memTotal,
      memUsed,
      memFree,
      memReserved,
      memPct,
      temperature,
      powerDraw,
      powerLimit,
      powerDefaultLimit,
      powerMaxLimit,
      fanSpeed,
      clockCore,
      clockCoreMax,
      clockSm,
      clockMem,
      clockMemMax,
      clockVideo,
      pstate,
      displayActive,
      persistenceMode,
      connectors: [],
      processes: [],
    });
  }

  if (gpus.length > 0) {
    const procsByIdx = await queryNvidiaProcesses(uuidsByIndex);
    for (const g of gpus) {
      g.processes = procsByIdx.get(g.index) || [];
    }
  }

  return gpus;
}

async function readNvidiaProcFallback() {
  const dirs = [
    SCAN_ROOT ? `${SCAN_ROOT}/proc/driver/nvidia/gpus` : null,
    '/proc/driver/nvidia/gpus',
  ].filter(Boolean);

  for (const base of dirs) {
    if (!existsSync(base)) continue;
    try {
      const entries = await fsp.readdir(base);
      const out = [];
      let idx = 0;
      for (const entry of entries) {
        const infoTxt = await readTextSafe(path.join(base, entry, 'information'));
        if (!infoTxt) continue;
        const map = {};
        for (const line of infoTxt.split('\n')) {
          const m = line.match(/^([^:]+):\s*(.+)$/);
          if (m) map[m[1].trim().toLowerCase()] = m[2].trim();
        }
        const busId = normalizeBusId(map['bus location'] || entry);
        out.push({
          index: idx++,
          id: map['gpu uuid'] || `nvidia-${busId || idx}`,
          name: map['model'] || 'NVIDIA GPU',
          vendor: 'NVIDIA',
          driver: map['gpu firmware'] || null,
          vbios: map['video bios'] || null,
          busId,
          pcieGen: null,
          pcieGenMax: null,
          pcieWidth: null,
          pcieWidthMax: null,
          utilization: null,
          memUtilization: null,
          encoderFps: null,
          memTotal: null,
          memUsed: null,
          memFree: null,
          memReserved: null,
          memPct: null,
          temperature: null,
          powerDraw: null,
          powerLimit: null,
          powerDefaultLimit: null,
          powerMaxLimit: null,
          fanSpeed: null,
          clockCore: null,
          clockCoreMax: null,
          clockSm: null,
          clockMem: null,
          clockMemMax: null,
          clockVideo: null,
          pstate: null,
          displayActive: null,
          persistenceMode: null,
          connectors: [],
          processes: [],
        });
      }
      if (out.length > 0) return out;
    } catch {
      /* ignore */
    }
  }
  return [];
}

function parseDpmClockMhz(txt) {
  if (!txt) return { current: null, max: null };
  let current = null;
  let max = null;
  for (const line of txt.split('\n')) {
    const m = line.match(/(\d+)\s*Mhz/i);
    if (!m) continue;
    const val = Number(m[1]);
    if (max == null || val > max) max = val;
    if (line.includes('*')) current = val;
  }
  return { current, max };
}

function pcieGenFromSpeed(speedTxt) {
  if (!speedTxt) return null;
  if (speedTxt.includes('2.5')) return 1;
  if (speedTxt.includes('5.0') || speedTxt.includes('5 ')) return 2;
  if (speedTxt.includes('8.0') || speedTxt.includes('8 ')) return 3;
  if (speedTxt.includes('16.0') || speedTxt.includes('16 ')) return 4;
  if (speedTxt.includes('32.0') || speedTxt.includes('32 ')) return 5;
  return null;
}

async function readCardConnectors(drmRoot, card) {
  const connectors = [];
  try {
    const entries = await fsp.readdir(drmRoot);
    const prefix = `${card}-`;
    for (const name of entries) {
      if (!name.startsWith(prefix)) continue;
      const connDir = path.join(drmRoot, name);
      const status = await readTextSafe(path.join(connDir, 'status'));
      if (!status) continue;
      const modesTxt = await readTextSafe(path.join(connDir, 'modes'));
      const mode = modesTxt ? modesTxt.split('\n')[0].trim() || null : null;
      connectors.push({
        name: name.slice(prefix.length),
        status,
        connected: status === 'connected',
        mode,
      });
    }
  } catch {
    /* ignore */
  }
  return connectors;
}

async function readHwmonMetrics(deviceDir) {
  const hwmonRoot = path.join(deviceDir, 'hwmon');
  if (!existsSync(hwmonRoot)) return {};
  try {
    const entries = await fsp.readdir(hwmonRoot);
    for (const sub of entries) {
      const hdir = path.join(hwmonRoot, sub);
      const tempRaw = await readIntSafe(path.join(hdir, 'temp1_input'));
      const powerAvgRaw =
        (await readIntSafe(path.join(hdir, 'power1_average'))) ??
        (await readIntSafe(path.join(hdir, 'power1_input')));
      const powerCapRaw = await readIntSafe(path.join(hdir, 'power1_cap'));
      const powerCapMaxRaw = await readIntSafe(path.join(hdir, 'power1_cap_max'));
      const powerCapDefaultRaw = await readIntSafe(path.join(hdir, 'power1_cap_default'));
      const pwmRaw = await readIntSafe(path.join(hdir, 'pwm1'));
      const pwmMax = (await readIntSafe(path.join(hdir, 'pwm1_max'))) || 255;

      return {
        temperature: tempRaw != null ? Math.round(tempRaw / 1000) : null,
        powerDraw: powerAvgRaw != null ? Number((powerAvgRaw / 1_000_000).toFixed(2)) : null,
        powerLimit: powerCapRaw != null ? Number((powerCapRaw / 1_000_000).toFixed(2)) : null,
        powerMaxLimit: powerCapMaxRaw != null ? Number((powerCapMaxRaw / 1_000_000).toFixed(2)) : null,
        powerDefaultLimit: powerCapDefaultRaw != null ? Number((powerCapDefaultRaw / 1_000_000).toFixed(2)) : null,
        fanSpeed: pwmRaw != null && pwmMax > 0 ? Math.round((pwmRaw / pwmMax) * 100) : null,
      };
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function readDrmGpus(pciNames) {
  const roots = [
    SCAN_ROOT ? `${SCAN_ROOT}/sys/class/drm` : null,
    '/sys/class/drm',
  ].filter(Boolean);

  for (const drmRoot of roots) {
    if (!existsSync(drmRoot)) continue;
    try {
      const entries = (await fsp.readdir(drmRoot)).filter((n) => /^card\d+$/.test(n));
      const out = [];
      for (const card of entries) {
        const devDir = path.join(drmRoot, card, 'device');
        if (!existsSync(devDir)) continue;

        const ueventTxt = await readTextSafe(path.join(devDir, 'uevent'));
        const uevent = {};
        if (ueventTxt) {
          for (const line of ueventTxt.split('\n')) {
            const idx = line.indexOf('=');
            if (idx > 0) uevent[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
          }
        }

        const vendorHex = (await readTextSafe(path.join(devDir, 'vendor'))) || uevent.PCI_ID?.split(':')[0];
        const vendor = vendorFromHex(vendorHex);
        if (vendor === 'Virtual' || vendor === 'ASPEED') continue;

        const busId = normalizeBusId(uevent.PCI_SLOT_NAME);
        const driver = uevent.DRIVER || null;
        const vbios = await readTextSafe(path.join(devDir, 'vbios_version'));

        const curSpeed = await readTextSafe(path.join(devDir, 'current_link_speed'));
        const maxSpeed = await readTextSafe(path.join(devDir, 'max_link_speed'));
        const pcieWidth = await readIntSafe(path.join(devDir, 'current_link_width'));
        const pcieWidthMax = await readIntSafe(path.join(devDir, 'max_link_width'));

        // Métricas AMD / DRM sysfs
        const gpuBusy = await readIntSafe(path.join(devDir, 'gpu_busy_percent'));
        const memBusy = await readIntSafe(path.join(devDir, 'mem_busy_percent'));
        const vramTotal = await readIntSafe(path.join(devDir, 'mem_info_vram_total'));
        const vramUsed = await readIntSafe(path.join(devDir, 'mem_info_vram_used'));
        const vramFree = vramTotal != null && vramUsed != null ? Math.max(0, vramTotal - vramUsed) : null;
        const memPct = vramTotal && vramUsed != null ? Math.min(100, Math.max(0, (vramUsed / vramTotal) * 100)) : null;

        // Clocks (AMD pp_dpm_sclk ou Intel gt_cur_freq_mhz)
        const sclk = parseDpmClockMhz(await readTextSafe(path.join(devDir, 'pp_dpm_sclk')));
        const mclk = parseDpmClockMhz(await readTextSafe(path.join(devDir, 'pp_dpm_mclk')));
        const intelCurFreq =
          (await readIntSafe(path.join(drmRoot, card, 'gt_cur_freq_mhz'))) ??
          (await readIntSafe(path.join(drmRoot, card, 'gt', 'gt0', 'rps_cur_freq_mhz')));
        const intelMaxFreq =
          (await readIntSafe(path.join(drmRoot, card, 'gt_max_freq_mhz'))) ??
          (await readIntSafe(path.join(drmRoot, card, 'gt', 'gt0', 'rps_max_freq_mhz')));

        const clockCore = sclk.current ?? intelCurFreq ?? null;
        const clockCoreMax = sclk.max ?? intelMaxFreq ?? null;
        const clockMem = mclk.current ?? null;
        const clockMemMax = mclk.max ?? null;

        const [hwmon, connectors] = await Promise.all([
          readHwmonMetrics(devDir),
          readCardConnectors(drmRoot, card),
        ]);
        const pciName = (busId && pciNames.get(busId)) || null;
        const fallbackName = pciName || `${vendor} Graphics (${card})`;

        out.push({
          index: out.length,
          id: busId ? `drm-${busId}` : card,
          name: fallbackName,
          vendor,
          driver,
          vbios: vbios || null,
          busId,
          pcieGen: pcieGenFromSpeed(curSpeed),
          pcieGenMax: pcieGenFromSpeed(maxSpeed),
          pcieWidth,
          pcieWidthMax,
          utilization: gpuBusy,
          memUtilization: memBusy,
          encoderFps: null,
          memTotal: vramTotal,
          memUsed: vramUsed,
          memFree: vramFree,
          memReserved: null,
          memPct,
          temperature: hwmon.temperature ?? null,
          powerDraw: hwmon.powerDraw ?? null,
          powerLimit: hwmon.powerLimit ?? null,
          powerDefaultLimit: hwmon.powerDefaultLimit ?? null,
          powerMaxLimit: hwmon.powerMaxLimit ?? null,
          fanSpeed: hwmon.fanSpeed ?? null,
          clockCore,
          clockCoreMax,
          clockSm: null,
          clockMem,
          clockMemMax,
          clockVideo: null,
          pstate: null,
          displayActive: connectors.some((c) => c.connected),
          persistenceMode: null,
          connectors,
          processes: [],
        });
      }
      if (out.length > 0) return out;
    } catch {
      /* ignore */
    }
  }
  return [];
}

export async function sampleGpus() {
  const [nvidiaSmiGpus, pciNames] = await Promise.all([queryNvidiaSmi(), loadPciGpuNames()]);
  const byBus = new Map();
  const result = [];

  for (const g of nvidiaSmiGpus) {
    if (g.busId) byBus.set(g.busId, g);
    result.push(g);
  }

  // Fallback para /proc/driver/nvidia/gpus quando nvidia-smi não está disponível no container
  if (nvidiaSmiGpus.length === 0) {
    const procNvidia = await readNvidiaProcFallback();
    for (const g of procNvidia) {
      if (g.busId) byBus.set(g.busId, g);
      result.push(g);
    }
  }

  const drmGpus = await readDrmGpus(pciNames);
  for (const d of drmGpus) {
    if (d.busId && byBus.has(d.busId)) {
      const existing = byBus.get(d.busId);
      if ((!existing.name || existing.name === 'NVIDIA GPU') && d.name) existing.name = d.name;
      if (existing.temperature == null && d.temperature != null) existing.temperature = d.temperature;
      if (existing.utilization == null && d.utilization != null) existing.utilization = d.utilization;
      if (existing.pcieGen == null && d.pcieGen != null) existing.pcieGen = d.pcieGen;
      if (existing.pcieGenMax == null && d.pcieGenMax != null) existing.pcieGenMax = d.pcieGenMax;
      if (existing.pcieWidth == null && d.pcieWidth != null) existing.pcieWidth = d.pcieWidth;
      if (existing.pcieWidthMax == null && d.pcieWidthMax != null) existing.pcieWidthMax = d.pcieWidthMax;
      if ((!existing.connectors || existing.connectors.length === 0) && d.connectors?.length) {
        existing.connectors = d.connectors;
      }
      if (existing.memTotal == null && d.memTotal != null) {
        existing.memTotal = d.memTotal;
        existing.memUsed = d.memUsed;
        existing.memFree = d.memFree;
        existing.memPct = d.memPct;
      }
      continue;
    }
    if (d.busId) byBus.set(d.busId, d);
    result.push(d);
  }

  result.forEach((g, idx) => {
    g.index = idx;
  });

  return {
    available: result.length > 0,
    count: result.length,
    gpus: result,
    primary: result[0] || null,
  };
}
