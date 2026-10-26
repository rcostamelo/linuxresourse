#!/usr/bin/env bash
set -euo pipefail

PORT=10450
if [ -f /etc/default/linux-resource ]; then
  # shellcheck disable=SC1091
  source /etc/default/linux-resource
fi

URL="http://127.0.0.1:${PORT}"

# 1. Janela nativa GTK4 + WebKitGTK (se python3-gi + gir1.2-webkit-6.0 / 4.1 estiverem instalados)
if command -v python3 >/dev/null 2>&1; then
  if python3 -c "import gi; gi.require_version('Gtk', '4.0'); gi.require_version('WebKit', '6.0')" >/dev/null 2>&1; then
    python3 - "$URL" <<'PYEOF' >/dev/null 2>&1 &
import sys, gi
gi.require_version('Gtk', '4.0')
gi.require_version('WebKit', '6.0')
from gi.repository import Gtk, WebKit, GLib

url = sys.argv[1]

class LinuxResourceApp(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="org.linuxresource.app")

    def do_activate(self):
        win = Gtk.ApplicationWindow(application=self)
        win.set_title("Linux Resource — Mission Control")
        win.set_default_size(1380, 860)
        webview = WebKit.WebView()
        settings = webview.get_settings()
        settings.set_enable_developer_extras(False)
        webview.load_uri(url)
        win.set_child(webview)
        win.present()

app = LinuxResourceApp()
app.run(None)
PYEOF
    exit 0
  elif python3 -c "import gi; gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')" >/dev/null 2>&1; then
    python3 - "$URL" <<'PYEOF' >/dev/null 2>&1 &
import sys, gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2

url = sys.argv[1]
win = Gtk.Window(title="Linux Resource — Mission Control")
win.set_default_size(1380, 860)
win.set_wmclass("linux-resource", "Linux Resource")
win.connect("destroy", Gtk.main_quit)
webview = WebKit2.WebView()
webview.load_uri(url)
win.add(webview)
win.show_all()
Gtk.main()
PYEOF
    exit 0
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
