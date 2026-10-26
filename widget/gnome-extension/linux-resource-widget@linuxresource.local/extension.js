import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Endpoint somente local (loopback), sem token.
const ENDPOINT = 'http://127.0.0.1:10451/api/widget/metrics';
const SERVICES_ENDPOINT = 'http://127.0.0.1:10451/api/widget/services';
const POLL_SECONDS = 2;
const SERVICES_POLL_SECONDS = 8;

const COLOR_OK = '#9ece6a';
const COLOR_WARN = '#e0af68';
const COLOR_CRIT = '#f7768e';

function levelColor(pct) {
  if (pct >= 85) return COLOR_CRIT;
  if (pct >= 60) return COLOR_WARN;
  return COLOR_OK;
}

function rate(bps) {
  if (bps >= 1024 ** 3) return `${(bps / 1024 ** 3).toFixed(1)}G`;
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)}M`;
  if (bps >= 1024) return `${Math.round(bps / 1024)}K`;
  return `${Math.round(bps)}B`;
}

function uptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function shortName(name) {
  const value = String(name || 'desconhecido');
  return value.length > 36 ? `${value.slice(0, 35)}…` : value;
}

function memorySize(bytes) {
  if (!bytes || bytes <= 0) return '0M';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}G` : `${Math.round(bytes / 1024 ** 2)}M`;
}

function panelLabel(text, style = 'font-weight: 600;') {
  return new St.Label({ text, y_align: Clutter.ActorAlign.CENTER, style });
}

function launchNativeWindow() {
  try {
    GLib.spawn_command_line_async('/usr/bin/linux-resource-window');
  } catch {
    try {
      GLib.spawn_command_line_async('xdg-open http://127.0.0.1:10450');
    } catch {
      /* ignore */
    }
  }
}

export default class LinuxResourceWidget extends Extension {
  enable() {
    this._session = new Soup.Session({ timeout: 10 });
    this._busy = false;
    this._servicesBusy = false;

    this._indicator = new PanelMenu.Button(0.0, 'Linux Resource', false);
    const row = new St.BoxLayout({ style: 'spacing: 8px;', y_align: Clutter.ActorAlign.CENTER });
    this._icon = new St.Icon({
      icon_name: 'linux-resource',
      fallback_icon_name: 'utilities-system-monitor-symbolic',
      style_class: 'system-status-icon',
    });
    this._cpuText = panelLabel('CPU --');
    this._ramText = panelLabel('RAM --');
    this._gpuText = panelLabel('GPU --');
    this._netText = panelLabel('↓0B ↑0B');
    this._cpuRamSeparator = panelLabel('·', 'opacity: 0.6;');
    this._ramGpuSeparator = panelLabel('·', 'opacity: 0.6;');
    this._gpuNetSeparator = panelLabel('·', 'opacity: 0.6;');
    this._gpuText.visible = false;
    this._ramGpuSeparator.visible = false;
    row.add_child(this._icon);
    for (const actor of [
      this._cpuText,
      this._cpuRamSeparator,
      this._ramText,
      this._ramGpuSeparator,
      this._gpuText,
      this._gpuNetSeparator,
      this._netText,
    ]) row.add_child(actor);
    this._indicator.add_child(row);

    this._hostItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
    this._loadItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
    this._swapItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
    this._gpuItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
    this._gpuItem.visible = false;
    for (const item of [this._hostItem, this._loadItem, this._swapItem, this._gpuItem]) {
      this._indicator.menu.addMenuItem(item);
    }

    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._dockerMenu = new PopupMenu.PopupSubMenuMenuItem('Docker: aguardando');
    this._procsMenu = new PopupMenu.PopupSubMenuMenuItem('PM2 / Procman: aguardando');
    this._indicator.menu.addMenuItem(this._dockerMenu);
    this._indicator.menu.addMenuItem(this._procsMenu);
    this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    this._openAppItem = new PopupMenu.PopupMenuItem('Abrir Aplicativo Linux Resource');
    this._openAppItem.connect('activate', () => launchNativeWindow());
    this._indicator.menu.addMenuItem(this._openAppItem);

    // Lado direito da barra, logo após o relógio.
    Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

    this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
      this._refresh();
      return GLib.SOURCE_CONTINUE;
    });
    this._servicesTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SERVICES_POLL_SECONDS, () => {
      this._refreshServices();
      return GLib.SOURCE_CONTINUE;
    });
    this._refresh();
    this._refreshServices();
  }

  disable() {
    if (this._timer) {
      GLib.source_remove(this._timer);
      this._timer = null;
    }
    if (this._servicesTimer) {
      GLib.source_remove(this._servicesTimer);
      this._servicesTimer = null;
    }
    this._session?.abort();
    this._session = null;
    this._indicator?.destroy();
    this._indicator = null;
  }

  _refresh() {
    if (this._busy || !this._session) return;
    this._busy = true;

    const msg = Soup.Message.new('GET', ENDPOINT);
    this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, result) => {
      if (!this._indicator || session !== this._session) return;
      this._busy = false;
      try {
        const bytes = session.send_and_read_finish(result);
        if (msg.get_status() !== Soup.Status.OK) throw new Error(`HTTP ${msg.get_status()}`);
        this._render(JSON.parse(new TextDecoder().decode(bytes.get_data())));
      } catch (e) {
        this._setOffline('sem conexão');
      }
    });
  }

  _refreshServices() {
    if (this._servicesBusy || !this._session) return;
    this._servicesBusy = true;
    const msg = Soup.Message.new('GET', SERVICES_ENDPOINT);
    this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, result) => {
      if (!this._indicator || session !== this._session) return;
      this._servicesBusy = false;
      try {
        const bytes = session.send_and_read_finish(result);
        if (msg.get_status() !== Soup.Status.OK) throw new Error(`HTTP ${msg.get_status()}`);
        this._renderServices(JSON.parse(new TextDecoder().decode(bytes.get_data())));
      } catch {
        this._dockerMenu.label.text = 'Docker: sem conexão';
        this._procsMenu.label.text = 'PM2 / Procman: sem conexão';
        this._dockerMenu.menu.removeAll();
        this._procsMenu.menu.removeAll();
      }
    });
  }

  _renderServices(data) {
    const docker = data.docker || {};
    const procs = data.procs || {};
    this._dockerMenu.label.text = docker.available
      ? `Docker: ${docker.running || 0}/${docker.total || 0} ativos`
      : 'Docker: indisponível';
    this._procsMenu.label.text = procs.total
      ? `PM2 / Procman: ${procs.online || 0}/${procs.total} online${procs.errored ? ` · ${procs.errored} erro(s)` : ''}`
      : 'PM2 / Procman: nenhum processo';

    this._dockerMenu.menu.removeAll();
    for (const container of (docker.containers || []).slice(0, 8)) {
      const usage = container.state === 'running'
        ? [container.cpu != null ? `${Number(container.cpu).toFixed(1)}%` : '', container.mem || ''].filter(Boolean).join(' ')
        : container.state;
      const label = `${shortName(container.name)} · ${usage || 'ativo'}`;
      this._dockerMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(label, { reactive: false, can_focus: false }));
    }

    this._procsMenu.menu.removeAll();
    for (const proc of (procs.list || []).slice(0, 8)) {
      const usage = proc.status === 'online'
        ? `${Math.round(Number(proc.cpu) || 0)}% ${memorySize(proc.memory)}`
        : proc.status;
      const label = `${shortName(proc.name)} · ${shortName(proc.engine)} · ${usage || 'desconhecido'}`;
      this._procsMenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(label, { reactive: false, can_focus: false }));
    }
  }

  _setOffline(reason) {
    this._cpuText.text = 'CPU --';
    this._cpuText.style = 'font-weight: 600;';
    this._ramText.text = 'RAM --';
    this._ramText.style = 'font-weight: 600;';
    this._netText.text = 'offline';
    this._gpuText.visible = false;
    this._ramGpuSeparator.visible = false;
    this._gpuItem.visible = false;
    this._hostItem.label.text = reason;
    this._loadItem.label.text = '';
    this._swapItem.label.text = '';
  }

  _render(d) {
    const cpu = Math.round(d.cpuUsage ?? 0);
    const ram = d.memory.total ? Math.round((d.memory.used / d.memory.total) * 100) : 0;
    const swapPct = d.memory.swapTotal ? (d.memory.swapUsed / d.memory.swapTotal) * 100 : 0;

    const temp = d.cpuTemp != null ? ` ${Math.round(d.cpuTemp)}°C` : '';
    this._cpuText.text = `CPU ${cpu}%${temp}`;
    this._cpuText.style = `font-weight: 600; color: ${levelColor(cpu)};`;
    this._ramText.text = `RAM ${ram}%`;
    this._ramText.style = `font-weight: 600; color: ${levelColor(ram)};`;
    this._netText.text = `↓${rate(d.network.rx)} ↑${rate(d.network.tx)}`;

    // GPU: usa a carga do núcleo; se indisponível, cai para o uso de VRAM.
    const g = d.gpu;
    const gpuPct = g ? Math.round(g.utilization ?? g.memPct ?? 0) : 0;
    this._gpuText.visible = !!g;
    this._ramGpuSeparator.visible = !!g;
    this._gpuItem.visible = !!g;
    if (g) {
      this._gpuText.text = `GPU ${gpuPct}%`;
      this._gpuText.style = `font-weight: 600; color: ${levelColor(gpuPct)};`;
      const parts = [g.name];
      if (g.utilization != null) parts.push(`${Math.round(g.utilization)}%`);
      if (g.memUsed != null && g.memTotal) {
        parts.push(`VRAM ${(g.memUsed / 1024 ** 3).toFixed(1)}/${(g.memTotal / 1024 ** 3).toFixed(1)} GB`);
      }
      if (g.temperature != null) parts.push(`${Math.round(g.temperature)}°C`);
      this._gpuItem.label.text = `GPU ${parts.join(' · ')}`;
    }

    this._hostItem.label.text = `${d.hostname} · ${d.cpuModel}`;
    this._loadItem.label.text =
      `Load ${d.loadavg.map((l) => l.toFixed(2)).join(' ')} · ${d.ncpu} CPUs · up ${uptime(d.uptime)}`;
    this._swapItem.label.text = d.memory.swapTotal
      ? `Swap ${swapPct.toFixed(0)}% · ${(d.memory.swapUsed / 1024 ** 3).toFixed(1)} GB`
      : 'Swap: nenhum';
  }
}
