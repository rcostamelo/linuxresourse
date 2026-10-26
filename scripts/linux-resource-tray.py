#!/usr/bin/env python3
"""Linux Resource — ícone de bandeja (system tray).

Roda junto com a sessão gráfica (autostart XDG) e funciona em KDE Plasma e GNOME:
  * KDE Plasma  -> StatusNotifierItem nativo via Qt (PyQt6/PyQt5)
  * GNOME       -> StatusNotifierItem/AppIndicator (extensão "AppIndicator" que o Ubuntu já traz)
  * Fallback    -> AyatanaAppIndicator3 via PyGObject, caso o Qt não esteja instalado

Clique esquerdo abre o aplicativo; clique direito abre o menu. Consulta somente o listener LOCAL
do widget (127.0.0.1:10451) e avisa quando há uma versão nova (notificação + item de menu).
"""

import fcntl
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request

WIDGET = os.environ.get("LR_WIDGET_URL", "http://127.0.0.1:10451")
PORT = os.environ.get("LR_PORT", "10450")
APP_ID = "org.linuxresource.tray"
POLL_SECONDS = 3
UPDATE_CHECK_SECONDS = 30 * 60
RENOTIFY_SECONDS = 24 * 3600

HOME = os.path.expanduser("~")
CACHE_DIR = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.join(HOME, ".cache")), "linux-resource")
CONFIG_DIR = os.environ.get("XDG_CONFIG_HOME", os.path.join(HOME, ".config"))
USER_AUTOSTART = os.path.join(CONFIG_DIR, "autostart", "linux-resource-tray.desktop")
SYSTEM_AUTOSTART = "/etc/xdg/autostart/linux-resource-tray.desktop"
NOTIFIED_FILE = os.path.join(CACHE_DIR, "tray-notified.json")

ICON_FILES = [
    "/usr/share/pixmaps/linux-resource.png",
    "/usr/share/icons/hicolor/256x256/apps/linux-resource.png",
    os.path.join(HOME, ".local/share/icons/hicolor/256x256/apps/linux-resource.png"),
    os.path.join(HOME, ".local/share/icons/hicolor/512x512/apps/linux-resource.png"),
]


# --------------------------------------------------------------------------- utilidades


def single_instance():
    os.makedirs(CACHE_DIR, exist_ok=True)
    lock = open(os.path.join(CACHE_DIR, "tray.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        sys.exit(0)  # já existe um ícone rodando
    return lock


def http_json(path, timeout=4):
    req = urllib.request.Request(WIDGET + path, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def fmt_rate(bps):
    bps = bps or 0
    if bps >= 1048576:
        return f"{bps / 1048576:.1f}M"
    if bps >= 1024:
        return f"{round(bps / 1024)}K"
    return f"{round(bps)}B"


def find_window_bin():
    for cand in (
        shutil.which("linux-resource-window"),
        os.path.join(HOME, ".local/share/bin/linux-resource-window"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "linux-resource-window.sh"),
    ):
        if cand and os.path.exists(cand):
            return cand
    return None


def open_app(tab=""):
    """Abre o aplicativo nativo (opcionalmente numa aba, ex.: 'sobre'); cai para o navegador."""
    win = find_window_bin()
    try:
        if win:
            subprocess.Popen([win] + ([tab] if tab else []), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            return
    except OSError:
        pass
    open_browser(tab)


def open_browser(tab=""):
    url = f"http://127.0.0.1:{PORT}" + (f"/#{tab}" if tab else "")
    subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def restart_service():
    """Reinicia o serviço conforme o modo de instalação (.deb/systemd ou Docker)."""
    try:
        if shutil.which("docker"):
            result = subprocess.run(
                ["docker", "ps", "--filter", "label=com.docker.compose.service=linux-resource", "--format", "{{.Names}}"],
                capture_output=True, text=True, timeout=5,
            )
            names = result.stdout.splitlines() if result.returncode == 0 else []
            if not names:
                for name in ("linux-resource", "linux-resource-host"):
                    inspected = subprocess.run(
                        ["docker", "inspect", "--format", "{{.State.Running}}", name],
                        capture_output=True, text=True, timeout=5,
                    )
                    if inspected.returncode == 0 and inspected.stdout.strip() == "true":
                        names = [name]
                        break
            if names:
                subprocess.Popen(["docker", "restart", names[0]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                return

        # Não inicie o serviço do pacote quando ele foi desabilitado porque o
        # backend está em Docker, inclusive se o daemon estiver inacessível.
        enabled = subprocess.run(["systemctl", "is-enabled", "--quiet", "linux-resource.service"], timeout=5)
        if enabled.returncode == 0:
            subprocess.Popen(["pkexec", "systemctl", "restart", "linux-resource.service"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    except (OSError, subprocess.SubprocessError):
        pass


def autostart_enabled():
    if os.path.exists(USER_AUTOSTART):
        try:
            return "Hidden=true" not in open(USER_AUTOSTART).read()
        except OSError:
            return True
    return os.path.exists(SYSTEM_AUTOSTART)


def set_autostart(enabled):
    os.makedirs(os.path.dirname(USER_AUTOSTART), exist_ok=True)
    if enabled and os.path.exists(SYSTEM_AUTOSTART):
        if os.path.exists(USER_AUTOSTART):
            os.remove(USER_AUTOSTART)
        return
    exec_cmd = "/usr/bin/linux-resource-tray" if os.path.exists("/usr/bin/linux-resource-tray") else os.path.abspath(__file__)
    with open(USER_AUTOSTART, "w") as f:
        f.write(
            "[Desktop Entry]\nType=Application\nName=Linux Resource (bandeja)\n"
            "Comment=Ícone de bandeja do Linux Resource\n"
            f"Exec={exec_cmd}\nIcon=linux-resource\nNoDisplay=true\n"
            f"Hidden={'false' if enabled else 'true'}\nX-GNOME-Autostart-enabled={'true' if enabled else 'false'}\n"
        )


def load_notified():
    try:
        return json.load(open(NOTIFIED_FILE))
    except (OSError, ValueError):
        return {}


def save_notified(data):
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        json.dump(data, open(NOTIFIED_FILE, "w"))
    except OSError:
        pass


# --------------------------------------------------------------------------- estado compartilhado


class State:
    """Atualizado por uma thread de rede; a UI só lê (sem bloquear o menu)."""

    def __init__(self):
        self.online = False
        self.cpu = 0
        self.temp = None
        self.ram = 0
        self.rx = 0
        self.tx = 0
        self.host = ""
        self.docker = None  # (running, total) ou None
        self.procs = None  # (online, total, errored) ou None
        self.update = {}
        self.force_update = False
        self._stop = False
        self._last_update_check = 0
        self._last_services = 0

    def start(self):
        threading.Thread(target=self._loop, daemon=True).start()

    def request_update_check(self):
        self.force_update = True

    def _loop(self):
        while not self._stop:
            try:
                d = http_json("/api/widget/metrics")
                self.online = True
                self.cpu = round(d.get("cpuUsage") or 0)
                self.temp = d.get("cpuTemp")
                mem = d.get("memory") or {}
                self.ram = round(mem["used"] / mem["total"] * 100) if mem.get("total") else 0
                net = d.get("network") or {}
                self.rx, self.tx = net.get("rx", 0), net.get("tx", 0)
                self.host = d.get("hostname") or ""
            except Exception:
                self.online = False
            now = time.time()
            if self.online and now - self._last_services > 10:
                self._last_services = now
                try:
                    s = http_json("/api/widget/services", timeout=8)
                    dk = s.get("docker") or {}
                    self.docker = (dk.get("running", 0), dk.get("total", 0)) if dk.get("available") else None
                    pr = s.get("procs") or {}
                    self.procs = (pr.get("online", 0), pr.get("total", 0), pr.get("errored", 0)) if pr.get("total") else None
                except Exception:
                    pass
            if self.online and (self.force_update or now - self._last_update_check > UPDATE_CHECK_SECONDS):
                try:
                    self.update = http_json("/api/widget/update" + ("?force=1" if self.force_update else ""), timeout=15)
                    self._last_update_check = now
                except Exception:
                    pass
                self.force_update = False
            time.sleep(POLL_SECONDS)

    # ----- texto para menu/tooltip
    def status_line(self):
        if not self.online:
            return "Serviço offline"
        t = f" {round(self.temp)}°C" if self.temp is not None else ""
        return f"CPU {self.cpu}%{t} · RAM {self.ram}%"

    def net_line(self):
        return f"Rede ↓{fmt_rate(self.rx)} ↑{fmt_rate(self.tx)}" if self.online else ""

    def services_line(self):
        parts = []
        if self.docker:
            parts.append(f"Docker {self.docker[0]}/{self.docker[1]}")
        if self.procs:
            err = f" ({self.procs[2]} erro)" if self.procs[2] else ""
            parts.append(f"PM2/Procman {self.procs[0]}/{self.procs[1]}{err}")
        return " · ".join(parts)

    def update_available(self):
        return bool(self.update.get("updateAvailable"))

    def update_label(self):
        return f"⬆ Nova versão {self.update.get('latestVersion')} disponível — Atualizar"

    def version_line(self):
        v = self.update.get("currentVersion")
        return f"Linux Resource v{v}" if v else "Linux Resource"

    def should_notify(self):
        if not self.update_available():
            return False
        ver = self.update.get("latestVersion")
        n = load_notified()
        return not (n.get("version") == ver and time.time() - n.get("at", 0) < RENOTIFY_SECONDS)

    def mark_notified(self):
        save_notified({"version": self.update.get("latestVersion"), "at": time.time()})

    def notify_text(self):
        return (
            "Nova versão disponível",
            f"Linux Resource {self.update.get('latestVersion')} (você usa {self.update.get('currentVersion')}). "
            "Clique para ver as novidades e atualizar.",
        )


# --------------------------------------------------------------------------- backend Qt


def run_qt(state):
    try:
        from PyQt6.QtCore import QTimer
        from PyQt6.QtGui import QAction, QColor, QIcon, QPainter, QPixmap
        from PyQt6.QtWidgets import QApplication, QMenu, QSystemTrayIcon

        trigger = QSystemTrayIcon.ActivationReason.Trigger
        info_icon = QSystemTrayIcon.MessageIcon.Information
        qt6 = True
    except ImportError:
        from PyQt5.QtCore import QTimer
        from PyQt5.QtGui import QColor, QIcon, QPainter, QPixmap
        from PyQt5.QtWidgets import QAction, QApplication, QMenu, QSystemTrayIcon

        trigger = QSystemTrayIcon.Trigger
        info_icon = QSystemTrayIcon.Information
        qt6 = False

    app = QApplication(sys.argv[:1])
    app.setQuitOnLastWindowClosed(False)
    app.setApplicationName("Linux Resource")
    app.setDesktopFileName(APP_ID)

    base = QIcon.fromTheme("linux-resource")
    if base.isNull():
        for f in ICON_FILES:
            if os.path.exists(f):
                base = QIcon(f)
                break

    def badge_icon():
        pm = base.pixmap(64, 64)
        out = QPixmap(pm)
        p = QPainter(out)
        p.setRenderHint(QPainter.RenderHint.Antialiasing if qt6 else QPainter.Antialiasing)
        p.setBrush(QColor("#22c55e"))
        p.setPen(QColor("#0b1220"))
        p.drawEllipse(36, 0, 28, 28)
        p.end()
        return QIcon(out)

    icon_normal, icon_update = base, badge_icon() if not base.isNull() else base

    tray = QSystemTrayIcon(icon_normal)
    menu = QMenu()

    title = QAction("Linux Resource")
    title.setEnabled(False)
    status = QAction("")
    status.setEnabled(False)
    net = QAction("")
    net.setEnabled(False)
    services = QAction("")
    services.setEnabled(False)
    upd = QAction("")
    upd.triggered.connect(lambda: open_app("sobre"))
    open_a = QAction("Abrir Linux Resource")
    open_a.triggered.connect(lambda: open_app())
    browser = QAction("Abrir no navegador")
    browser.triggered.connect(lambda: open_browser())
    check = QAction("Verificar atualizações")
    check.triggered.connect(lambda: (state.request_update_check(), tray.showMessage("Linux Resource", "Verificando atualizações…", info_icon, 3000)))
    restart = QAction("Reiniciar serviço")
    restart.triggered.connect(restart_service)
    auto = QAction("Iniciar com o sistema")
    auto.setCheckable(True)
    auto.setChecked(autostart_enabled())
    auto.toggled.connect(set_autostart)
    quit_a = QAction("Sair do ícone")
    quit_a.triggered.connect(app.quit)

    for a in (title, status, net, services):
        menu.addAction(a)
    menu.addSeparator()
    menu.addAction(upd)
    menu.addAction(open_a)
    menu.addAction(browser)
    menu.addSeparator()
    menu.addAction(check)
    menu.addAction(restart)
    menu.addAction(auto)
    menu.addSeparator()
    menu.addAction(quit_a)
    tray.setContextMenu(menu)

    def on_activated(reason):
        if reason == trigger:
            open_app()

    tray.activated.connect(on_activated)
    tray.messageClicked.connect(lambda: open_app("sobre") if state.update_available() else open_app())

    last = {"upd": None}

    def refresh():
        title.setText(state.version_line())
        status.setText(state.status_line())
        net.setText(state.net_line())
        net.setVisible(bool(state.net_line()))
        sl = state.services_line()
        services.setText(sl)
        services.setVisible(bool(sl))
        avail = state.update_available()
        upd.setVisible(avail)
        if avail:
            upd.setText(state.update_label())
        if avail != last["upd"]:
            tray.setIcon(icon_update if avail else icon_normal)
            last["upd"] = avail
        tip = state.status_line() + ("\n" + state.services_line() if sl else "")
        if avail:
            tip += "\n" + state.update_label()
        tray.setToolTip("Linux Resource\n" + tip)
        if state.should_notify():
            t, m = state.notify_text()
            tray.showMessage(t, m, info_icon, 20000)
            state.mark_notified()

    timer = QTimer()
    timer.timeout.connect(refresh)
    timer.start(2000)
    refresh()
    tray.show()
    return app.exec() if qt6 else app.exec_()


# --------------------------------------------------------------------------- backend GTK + AppIndicator


def run_gtk(state):
    import gi

    gi.require_version("Gtk", "3.0")
    indicator_mod = None
    for name in ("AyatanaAppIndicator3", "AppIndicator3"):
        try:
            gi.require_version(name, "0.1")
            indicator_mod = __import__("gi.repository", fromlist=[name])
            indicator_mod = getattr(indicator_mod, name)
            break
        except (ValueError, ImportError):
            continue
    if indicator_mod is None:
        raise ImportError("AppIndicator indisponível")
    from gi.repository import GLib, Gtk

    try:
        gi.require_version("Notify", "0.7")
        from gi.repository import Notify

        Notify.init("Linux Resource")
    except (ValueError, ImportError):
        Notify = None

    icon = "linux-resource"
    for f in ICON_FILES:
        if os.path.exists(f):
            icon = f
            break

    ind = indicator_mod.Indicator.new(APP_ID, icon, indicator_mod.IndicatorCategory.APPLICATION_STATUS)
    ind.set_status(indicator_mod.IndicatorStatus.ACTIVE)
    ind.set_title("Linux Resource")

    menu = Gtk.Menu()

    def item(label, cb=None, sensitive=True):
        mi = Gtk.MenuItem(label=label)
        mi.set_sensitive(sensitive)
        if cb:
            mi.connect("activate", lambda *_: cb())
        menu.append(mi)
        return mi

    title = item("Linux Resource", sensitive=False)
    status = item("", sensitive=False)
    net = item("", sensitive=False)
    services = item("", sensitive=False)
    menu.append(Gtk.SeparatorMenuItem())
    upd = item("", lambda: open_app("sobre"))
    open_item = item("Abrir Linux Resource", open_app)
    item("Abrir no navegador", open_browser)
    menu.append(Gtk.SeparatorMenuItem())
    item("Verificar atualizações", state.request_update_check)
    item("Reiniciar serviço", restart_service)
    auto = Gtk.CheckMenuItem(label="Iniciar com o sistema")
    auto.set_active(autostart_enabled())
    auto.connect("toggled", lambda w: set_autostart(w.get_active()))
    menu.append(auto)
    menu.append(Gtk.SeparatorMenuItem())
    item("Sair do ícone", Gtk.main_quit)
    menu.show_all()
    ind.set_menu(menu)
    # clique esquerdo/meio: abre o app (suportado por Ayatana via "secondary activate")
    try:
        ind.set_secondary_activate_target(open_item)
    except Exception:
        pass

    def refresh():
        title.set_label(state.version_line())
        status.set_label(state.status_line())
        nl = state.net_line()
        net.set_label(nl)
        net.set_visible(bool(nl))
        sl = state.services_line()
        services.set_label(sl)
        services.set_visible(bool(sl))
        avail = state.update_available()
        upd.set_visible(avail)
        if avail:
            upd.set_label(state.update_label())
        if avail and state.should_notify() and Notify:
            t, m = state.notify_text()
            n = Notify.Notification.new(t, m, "linux-resource")
            n.add_action("default", "Atualizar", lambda *_: open_app("sobre"))
            n.add_action("update", "Atualizar", lambda *_: open_app("sobre"))
            n.show()
            state.mark_notified()
        return True

    GLib.timeout_add_seconds(2, refresh)
    refresh()
    Gtk.main()


# --------------------------------------------------------------------------- main


def main():
    _lock = single_instance()  # noqa: F841 (mantém o lock durante a vida do processo)
    state = State()
    state.start()
    errors = []
    for backend in (run_qt, run_gtk):
        try:
            return backend(state) or 0
        except ImportError as e:
            errors.append(f"{backend.__name__}: {e}")
    sys.stderr.write(
        "linux-resource-tray: nenhum backend de bandeja disponível.\n"
        "Instale python3-pyqt6 (ou python3-pyqt5) ou gir1.2-ayatanaappindicator3-0.1.\n" + "\n".join(errors) + "\n"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
