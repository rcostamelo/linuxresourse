#!/usr/bin/env bash
set -euo pipefail

PORT=10450
if [ -f /etc/default/linux-resource ]; then
  # shellcheck disable=SC1091
  source /etc/default/linux-resource
fi

BASE_URL="http://127.0.0.1:${PORT}"
# Argumento opcional: aba a abrir (ex.: "sobre"), usado pelo ícone de bandeja/alerta de atualização
TAB="${1:-}"
TAB="${TAB#--tab=}"
TAB="${TAB#--tab}"
URL="$BASE_URL"
[ -n "$TAB" ] && URL="${BASE_URL}/#${TAB}"

# 1. Janela nativa GTK4 + WebKitGTK (com application_id = linux-resource para associar o ícone no Wayland/KDE/GNOME)
PYTHON="$(command -v python3 || true)"
if [ -x /usr/bin/python3 ]; then PYTHON=/usr/bin/python3; fi
if [ -n "$PYTHON" ]; then
  if "$PYTHON" -c "import gi; gi.require_version('Gtk', '4.0'); gi.require_version('WebKit', '6.0')" >/dev/null 2>&1; then
    if GSK_RENDERER=cairo WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 "$PYTHON" - "$BASE_URL" "$TAB" <<'PYEOF'
import os, sys, gi
gi.require_version('Gtk', '4.0')
gi.require_version('WebKit', '6.0')
from gi.repository import Gtk, WebKit, GLib, Gio

base_url = sys.argv[1]
initial_tab = sys.argv[2] if len(sys.argv) > 2 else ""
GLib.set_prgname("linux-resource")
GLib.set_application_name("Linux Resource")

profile_dir = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "linux-resource-window")
data_dir = os.path.join(profile_dir, "webkit-data")
cache_dir = os.path.join(profile_dir, "webkit-cache")
os.makedirs(data_dir, exist_ok=True)
os.makedirs(cache_dir, exist_ok=True)

class LinuxResourceApp(Gtk.Application):
    def __init__(self):
        # HANDLES_COMMAND_LINE: uma segunda execução (ex.: bandeja -> "sobre") reaproveita a janela aberta
        super().__init__(application_id="org.linuxresource.app", flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.win = None
        self.webview = None
        self.net_session = None

    def show(self, tab):
        target = base_url + ("/#" + tab if tab else "")
        if self.win is None:
            self.win = Gtk.ApplicationWindow(application=self)
            self.win.set_title("Linux Resource — Mission Control")
            self.win.set_default_size(1380, 860)
            self.win.set_icon_name("linux-resource")

            try:
                self.net_session = WebKit.NetworkSession.new(data_dir, cache_dir)
                cookie_mgr = self.net_session.get_cookie_manager()
                cookie_mgr.set_persistent_storage(
                    os.path.join(data_dir, "cookies.sqlite"),
                    WebKit.CookiePersistentStorage.SQLITE,
                )
                cookie_mgr.set_accept_policy(WebKit.CookieAcceptPolicy.ALWAYS)
                self.webview = WebKit.WebView(network_session=self.net_session)
            except Exception:
                self.webview = WebKit.WebView()

            settings = self.webview.get_settings()
            settings.set_enable_developer_extras(False)
            try:
                settings.set_hardware_acceleration_policy(WebKit.HardwareAccelerationPolicy.NEVER)
            except Exception:
                pass

            self.webview.load_uri(target)
            self.win.set_child(self.webview)
            self.win.connect("close-request", self.on_close)
        elif tab:
            # só muda o hash: o app React troca de aba sem recarregar
            self.webview.evaluate_javascript("location.hash = %r" % tab, -1, None, None, None, None, None)
        self.win.present()

    def on_close(self, *_):
        self.win = None
        self.webview = None
        return False

    def do_command_line(self, cmdline):
        args = cmdline.get_arguments()[1:]
        try:
            self.show(args[0] if args else "")
            return 0
        except Exception:
            import traceback
            traceback.print_exc()
            return 1

app = LinuxResourceApp()
sys.exit(app.run(["linux-resource"] + ([initial_tab] if initial_tab else [])))
PYEOF
    then
      exit 0
    fi
  fi
  if "$PYTHON" -c "import gi; gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')" >/dev/null 2>&1; then
    if WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 "$PYTHON" - "$URL" <<'PYEOF'
import sys, os, gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

url = sys.argv[1]
GLib.set_prgname("linux-resource")
GLib.set_application_name("Linux Resource")

profile_dir = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "linux-resource-window")
data_dir = os.path.join(profile_dir, "webkit2-data")
os.makedirs(data_dir, exist_ok=True)

try:
    ctx = WebKit2.WebContext.get_default()
    cookie_mgr = ctx.get_cookie_manager()
    cookie_mgr.set_persistent_storage(
        os.path.join(data_dir, "cookies.sqlite"),
        WebKit2.CookiePersistentStorage.SQLITE,
    )
    cookie_mgr.set_accept_policy(WebKit2.CookieAcceptPolicy.ALWAYS)
except Exception:
    pass

win = Gtk.Window(title="Linux Resource — Mission Control")
win.set_default_size(1380, 860)
win.set_wmclass("linux-resource", "Linux Resource")
win.set_icon_name("linux-resource")
for p in ["/usr/share/pixmaps/linux-resource.png", os.path.expanduser("~/.local/share/icons/hicolor/256x256/apps/linux-resource.png")]:
    if os.path.exists(p):
        try:
            win.set_icon_from_file(p)
            break
        except Exception:
            pass
win.connect("destroy", Gtk.main_quit)
webview = WebKit2.WebView()
try:
    webview.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
except Exception:
    pass
webview.load_uri(url)
win.add(webview)
win.show_all()
Gtk.main()
PYEOF
    then
      exit 0
    fi
  fi
fi

# 2. Janela dedicada sem barra de endereço / abas via motores Chromium instalados no Linux (--app)
PROFILE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/linux-resource-window"
mkdir -p "$PROFILE_DIR"

for bin in \
  google-chrome \
  google-chrome-stable \
  chromium \
  chromium-browser \
  brave-browser \
  microsoft-edge \
  microsoft-edge-stable \
  vivaldi \
  opera; do
  if command -v "$bin" >/dev/null 2>&1; then
    nohup "$bin" \
      --app="$URL" \
      --class="linux-resource" \
      --name="Linux Resource" \
      --user-data-dir="$PROFILE_DIR" \
      --window-size=1380,860 \
      --no-first-run \
      --no-default-browser-check \
      >/dev/null 2>&1 &
    exit 0
  fi
done

# 3. Fallback caso não haja WebKitGTK nem motor Chromium
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 &
  exit 0
fi

echo "Acesse o Linux Resource em: $URL"
