import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const ENDPOINT = 'http://127.0.0.1:10450/api/widget/metrics';
const POLL_SECONDS = 2;
const TOKEN_FILE = ['linux-resource-widget', 'token'];
const SYSTEM_TOKEN_FILE = '/etc/linux-resource/widget-token';

// Ícones simbólicos do Adwaita (tema de fallback do GNOME, sempre instalado).
const ICONS = {
  cpu: 'computer-symbolic',
  ram: 'media-flash-symbolic',
  gpu: 'video-display-symbolic',
  net: 'network-transmit-receive-symbolic',
};

const COLOR_OK = '#9ece6a';
const COLOR_WARN = '#e0af68';
const COLOR_CRIT = '#f7768e';

// Primeiro o token do usuário (~/.config), depois o do sistema instalado pelo .deb.
function readToken() {
  const candidates = [GLib.build_filenamev([GLib.get_user_config_dir(), ...TOKEN_FILE]), SYSTEM_TOKEN_FILE];
  for (const path of candidates) {
    try {
      const [ok, contents] = GLib.file_get_contents(path);
      if (ok) return new TextDecoder().decode(contents).trim();
    } catch {
      /* arquivo ausente: tenta o próximo */
    }
  }
  return '';
}

function levelColor(pct) {
  if (pct >= 85) return COLOR_CRIT;
  if (pct >= 60) return COLOR_WARN;
  return COLOR_OK;
}

function rate(bps) {
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

function metric(iconName) {
  const box = new St.BoxLayout({ style: 'spacing: 5px;', y_align: Clutter.ActorAlign.CENTER });
  const icon = new St.Icon({ icon_name: iconName, style_class: 'system-status-icon' });
  const text = new St.Label({ text: '--', y_align: Clutter.ActorAlign.CENTER });
  box.add_child(icon);
  box.add_child(text);
  return { box, text };
}

export default class LinuxResourceWidget extends Extension {
  enable() {
    this._session = new Soup.Session({ timeout: 3 });
    this._token = readToken();
    this._busy = false;

    this._indicator = new PanelMenu.Button(0.0, 'Linux Resource', false);
    const row = new St.BoxLayout({ style: 'spacing: 12px;', y_align: Clutter.ActorAlign.CENTER });
    this._cpu = metric(ICONS.cpu);
    this._ram = metric(ICONS.ram);
    this._gpu = metric(ICONS.gpu);
    this._gpu.box.visible = false; // só aparece quando existir placa de vídeo
    this._net = metric(ICONS.net);
    for (const m of [this._cpu, this._ram, this._gpu, this._net]) row.add_child(m.box);
    this._indicator.add_child(row);

    this._hostItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
    this._loadItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
    this._swapItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
    this._gpuItem = new PopupMenu.PopupMenuItem('', { reactive: false, can_focus: false });
    this._gpuItem.visible = false;
    for (const item of [this._hostItem, this._loadItem, this._swapItem, this._gpuItem]) this._indicator.menu.addMenuItem(item);

    // Lado direito da barra, logo após o relógio.
    Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

    this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
      this._refresh();
      return GLib.SOURCE_CONTINUE;
    });
    this._refresh();
  }

  disable() {
    if (this._timer) {
      GLib.source_remove(this._timer);
      this._timer = null;
    }
    this._session?.abort();
    this._session = null;
    this._indicator?.destroy();
    this._indicator = null;
  }

  _refresh() {
    if (this._busy || !this._session) return;
    if (!this._token) {
      this._setOffline('sem token');
      return;
    }
    this._busy = true;

    const msg = Soup.Message.new('GET', ENDPOINT);
    msg.get_request_headers().append('X-Widget-Token', this._token);
    this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null, (session, result) => {
      this._busy = false;
      if (!this._indicator) return;
      try {
        const bytes = session.send_and_read_finish(result);
        if (msg.get_status() !== Soup.Status.OK) throw new Error(`HTTP ${msg.get_status()}`);
        this._render(JSON.parse(new TextDecoder().decode(bytes.get_data())));
      } catch (e) {
        this._setOffline('sem conexão');
      }
    });
  }

  _setOffline(reason) {
    this._cpu.text.text = '--';
    this._ram.text.text = '--';
    this._net.text.text = '--';
    this._gpu.box.visible = false;
    this._gpuItem.visible = false;
    this._hostItem.label.text = reason;
    this._loadItem.label.text = '';
    this._swapItem.label.text = '';
  }

  _render(d) {
    const cpu = Math.round(d.cpuUsage ?? 0);
    const ram = d.memory.total ? Math.round((d.memory.used / d.memory.total) * 100) : 0;
    const swapPct = d.memory.swapTotal ? (d.memory.swapUsed / d.memory.swapTotal) * 100 : 0;

    this._cpu.text.text = d.cpuTemp != null ? `${cpu}% ${Math.round(d.cpuTemp)}°C` : `${cpu}%`;
    this._cpu.text.style = `font-weight: 600; color: ${levelColor(cpu)};`;
    this._ram.text.text = `${ram}%`;
    this._ram.text.style = `font-weight: 600; color: ${levelColor(ram)};`;
    this._net.text.text = `↓${rate(d.network.rx)} ↑${rate(d.network.tx)}`;

    // GPU: usa a carga do núcleo; se indisponível, cai para o uso de VRAM.
    const g = d.gpu;
    const gpuPct = g ? Math.round(g.utilization ?? g.memPct ?? 0) : 0;
    this._gpu.box.visible = !!g;
    this._gpuItem.visible = !!g;
    if (g) {
      this._gpu.text.text = `${gpuPct}%`;
      this._gpu.text.style = `font-weight: 600; color: ${levelColor(gpuPct)};`;
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
