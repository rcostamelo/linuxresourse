import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { SCAN_ROOT } from './config.js';

// Drivers hwmon que expõem a temperatura do processador (em ordem de preferência).
const CPU_DRIVERS = ['k10temp', 'zenpower', 'coretemp', 'cpu_thermal', 'cpu-thermal', 'soc_thermal', 'armada_thermal'];
// Rótulos que representam o pacote/die inteiro (preferidos sobre núcleos individuais).
const PACKAGE_LABEL = /^(tctl|tdie|package id \d+|cpu|soc|cpu temp(erature)?)$/i;

const ROOTS = [SCAN_ROOT ? `${SCAN_ROOT}/sys/class` : null, '/sys/class'].filter(Boolean);

async function readText(file) {
  try {
    return (await fsp.readFile(file, 'utf8')).trim();
  } catch {
    return null;
  }
}

async function readMilli(file) {
  const t = await readText(file);
  if (t == null || t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n / 100) / 10 : null; // m°C -> °C com 1 casa
}

async function readHwmon(dir) {
  const files = await fsp.readdir(dir).catch(() => []);
  const sensors = [];
  for (const f of files) {
    const m = /^temp(\d+)_input$/.exec(f);
    if (!m) continue;
    const idx = m[1];
    const temp = await readMilli(path.join(dir, f));
    if (temp == null || temp <= 0 || temp > 150) continue;
    sensors.push({
      label: (await readText(path.join(dir, `temp${idx}_label`))) || `temp${idx}`,
      temp,
      max: await readMilli(path.join(dir, `temp${idx}_max`)),
      crit: await readMilli(path.join(dir, `temp${idx}_crit`)),
    });
  }
  return sensors;
}

function build(name, sensors) {
  const pkg = sensors.find((s) => PACKAGE_LABEL.test(s.label)) ?? null;
  const cores = sensors.filter((s) => s !== pkg && /^(core|tccd|ccd)/i.test(s.label));
  const main = pkg ?? (cores.length ? cores.reduce((a, b) => (b.temp > a.temp ? b : a)) : sensors[0]);
  return {
    available: true,
    temperature: main.temp,
    label: main.label,
    sensor: name,
    max: main.max ?? null,
    crit: main.crit ?? null,
    cores: cores.map((c) => ({ label: c.label, temp: c.temp })),
  };
}

/** Lê a temperatura da CPU via hwmon (k10temp/coretemp/...) com fallback para thermal_zone. */
export async function sampleCpuTemp() {
  for (const root of ROOTS) {
    // 1) hwmon com driver conhecido de CPU
    const hwmonDir = path.join(root, 'hwmon');
    const entries = await fsp.readdir(hwmonDir).catch(() => []);
    const found = [];
    for (const e of entries) {
      const dir = path.join(hwmonDir, e);
      const name = await readText(path.join(dir, 'name'));
      if (name && CPU_DRIVERS.includes(name)) found.push({ dir, name });
    }
    found.sort((a, b) => CPU_DRIVERS.indexOf(a.name) - CPU_DRIVERS.indexOf(b.name));
    for (const { dir, name } of found) {
      const sensors = await readHwmon(dir);
      if (sensors.length) return build(name, sensors);
    }

    // 2) thermal_zone (x86_pkg_temp, cpu-thermal, acpitz)
    const thermalDir = path.join(root, 'thermal');
    const zones = (await fsp.readdir(thermalDir).catch(() => [])).filter((z) => z.startsWith('thermal_zone'));
    const candidates = [];
    for (const z of zones) {
      const type = await readText(path.join(thermalDir, z, 'type'));
      const temp = await readMilli(path.join(thermalDir, z, 'temp'));
      if (type && temp != null && temp > 0 && temp < 150) candidates.push({ type, temp });
    }
    const pick =
      candidates.find((c) => /x86_pkg_temp|cpu|soc/i.test(c.type)) ?? candidates.find((c) => /acpitz/i.test(c.type));
    if (pick) {
      return { available: true, temperature: pick.temp, label: pick.type, sensor: 'thermal_zone', max: null, crit: null, cores: [] };
    }
  }
  return { available: false, temperature: null, label: null, sensor: null, max: null, crit: null, cores: [] };
}
