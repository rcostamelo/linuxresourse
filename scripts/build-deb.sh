#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PKG_NAME="linux-resource"
VERSION="$(node -p "require('./package.json').version")"
ARCH="all"
OUT_DIR="$ROOT_DIR/release"
DEB_FILE="$OUT_DIR/${PKG_NAME}_${VERSION}_${ARCH}.deb"
STAGE_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

echo "==> [1/4] Compilando frontend (npm run build)..."
npm run build

echo "==> [2/4] Montando estrutura do pacote Debian (${PKG_NAME}_${VERSION}_${ARCH})..."
mkdir -p \
  "$STAGE_DIR/DEBIAN" \
  "$STAGE_DIR/opt/$PKG_NAME" \
  "$STAGE_DIR/etc/default" \
  "$STAGE_DIR/lib/systemd/system" \
  "$STAGE_DIR/usr/bin" \
  "$STAGE_DIR/usr/share/applications" \
  "$STAGE_DIR/usr/share/pixmaps" \
  "$STAGE_DIR/usr/share/icons/hicolor/256x256/apps" \
  "$STAGE_DIR/usr/share/gnome-shell/extensions" \
  "$STAGE_DIR/usr/share/plasma/plasmoids" \
  "$STAGE_DIR/etc/xdg/autostart" \
  "$STAGE_DIR/var/lib/$PKG_NAME"

cp -r "$ROOT_DIR/dist" "$STAGE_DIR/opt/$PKG_NAME/dist"
cp -r "$ROOT_DIR/server" "$STAGE_DIR/opt/$PKG_NAME/server"
cp "$ROOT_DIR/package.json" "$STAGE_DIR/opt/$PKG_NAME/package.json"
[ -f "$ROOT_DIR/LICENSE" ] && cp "$ROOT_DIR/LICENSE" "$STAGE_DIR/opt/$PKG_NAME/LICENSE"
[ -f "$ROOT_DIR/README.md" ] && cp "$ROOT_DIR/README.md" "$STAGE_DIR/opt/$PKG_NAME/README.md"
[ -f "$ROOT_DIR/public/logo-mark.png" ] && cp "$ROOT_DIR/public/logo-mark.png" "$STAGE_DIR/usr/share/pixmaps/$PKG_NAME.png"
[ -f "$ROOT_DIR/public/logo-mark.png" ] && cp "$ROOT_DIR/public/logo-mark.png" "$STAGE_DIR/usr/share/icons/hicolor/256x256/apps/$PKG_NAME.png"
[ -f "$ROOT_DIR/public/logo-mark.png" ] && cp "$ROOT_DIR/public/logo-mark.png" "$STAGE_DIR/usr/share/icons/hicolor/256x256/apps/org.linuxresource.app.png"

# 1. Widget para GNOME Shell (instalado em /usr/share/gnome-shell/extensions)
WIDGET_UUID="linux-resource-widget@linuxresource.local"
cp -r "$ROOT_DIR/widget/gnome-extension/$WIDGET_UUID" "$STAGE_DIR/usr/share/gnome-shell/extensions/$WIDGET_UUID"
printf '%s\n' "$VERSION" > "$STAGE_DIR/usr/share/gnome-shell/extensions/$WIDGET_UUID/.linux-resource-package-version"

# 2. Widget para KDE Plasma (Plasmoid instalado em /usr/share/plasma/plasmoids)
KDE_PLASMOID_ID="org.linuxresource.widget"
cp -r "$ROOT_DIR/widget/kde-plasmoid/$KDE_PLASMOID_ID" "$STAGE_DIR/usr/share/plasma/plasmoids/$KDE_PLASMOID_ID"

# 3. Launcher de Janela Nativa (GTK4/GTK3 WebKitGTK ou modo App standalone sem barra de navegador)
cp "$ROOT_DIR/scripts/linux-resource-window.sh" "$STAGE_DIR/usr/bin/linux-resource-window"
chmod 0755 "$STAGE_DIR/usr/bin/linux-resource-window"

# 4. Detector automático de Desktop Environment (GNOME ou KDE Plasma) para ativar o widget na barra
cp "$ROOT_DIR/scripts/linux-resource-desktop-setup.sh" "$STAGE_DIR/usr/bin/linux-resource-desktop-setup"
chmod 0755 "$STAGE_DIR/usr/bin/linux-resource-desktop-setup"

# Instala o ícone de bandeja (system tray)
cp "$ROOT_DIR/scripts/linux-resource-tray.py" "$STAGE_DIR/usr/bin/linux-resource-tray"
chmod 0755 "$STAGE_DIR/usr/bin/linux-resource-tray"

# Arquivo de configuração em /etc/default/linux-resource
cat > "$STAGE_DIR/etc/default/$PKG_NAME" <<'EOF'
# Configuração do serviço Linux Resource
HOST=0.0.0.0
PORT=10450
DATA_DIR=/var/lib/linux-resource
# NODE_BIN=/caminho/para/node (opcional; detecta automaticamente /usr/bin/node ou NVM/FNM/Volta)
# TRUST_PROXY=0
EOF

# Runner inteligente que localiza Node >= 22 em /usr/bin, /usr/local/bin, /root/.nvm ou /home/*/.nvm
cat > "$STAGE_DIR/opt/$PKG_NAME/run-server.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

find_node() {
  if [ -n "${NODE_BIN:-}" ] && [ -x "$NODE_BIN" ]; then
    echo "$NODE_BIN"
    return 0
  fi

  local candidates=()
  for p in /usr/local/bin/node /usr/bin/node /root/.volta/bin/node /root/.local/share/fnm/aliases/default/bin/node; do
    [ -x "$p" ] && candidates+=("$p")
  done

  shopt -s nullglob
  for p in \
    /root/.nvm/versions/node/v*/bin/node \
    /home/*/.nvm/versions/node/v*/bin/node \
    /home/*/.local/share/fnm/node-versions/v*/installation/bin/node \
    /home/*/.volta/bin/node \
    /usr/local/nvm/versions/node/v*/bin/node; do
    [ -x "$p" ] && candidates+=("$p")
  done
  shopt -u nullglob

  local best=""
  local best_major=0
  for bin in "${candidates[@]}"; do
    local ver major
    ver="$("$bin" -v 2>/dev/null || true)"
    major="$(echo "${ver#v}" | cut -d. -f1)"
    if [[ "$major" =~ ^[0-9]+$ ]] && [ "$major" -ge 22 ] && [ "$major" -ge "$best_major" ]; then
      best="$bin"
      best_major="$major"
    fi
  done

  if [ -n "$best" ]; then
    echo "$best"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  return 1
}

RESOLVED_NODE="$(find_node || true)"
if [ -z "$RESOLVED_NODE" ]; then
  echo "Erro: Node.js >= 22.5 nao encontrado em /usr/bin nem em NVM/FNM/Volta." >&2
  exit 1
fi

NODE_DIR="$(dirname "$RESOLVED_NODE")"
export PATH="$NODE_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
exec "$RESOLVED_NODE" --disable-warning=ExperimentalWarning /opt/linux-resource/server/index.js
EOF
chmod 0755 "$STAGE_DIR/opt/$PKG_NAME/run-server.sh"

# Unidade systemd
cat > "$STAGE_DIR/lib/systemd/system/$PKG_NAME.service" <<'EOF'
[Unit]
Description=Linux Resource - System & Telemetry Console
Documentation=https://github.com/rcostamelo/linuxresourse
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=-/etc/default/linux-resource
WorkingDirectory=/opt/linux-resource
ExecStart=/opt/linux-resource/run-server.sh
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=linux-resource

[Install]
WantedBy=multi-user.target
EOF

# Utilitário de linha de comando /usr/bin/linux-resource
cat > "$STAGE_DIR/usr/bin/$PKG_NAME" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

PORT=10450
if [ -f /etc/default/linux-resource ]; then
  # shellcheck disable=SC1091
  source /etc/default/linux-resource
fi

cmd="${1:-app}"
case "$cmd" in
  app|window|gui)
    exec /usr/bin/linux-resource-window
    ;;
  widget)
    exec /usr/bin/linux-resource-desktop-setup
    ;;
  tray)
    nohup /usr/bin/linux-resource-tray >/dev/null 2>&1 &
    echo "Ícone de bandeja iniciado."
    ;;
  status)
    systemctl status linux-resource.service --no-pager
    ;;
  start|stop|restart|reload)
    sudo systemctl "$cmd" linux-resource.service
    ;;
  logs)
    journalctl -u linux-resource.service -f -n 100
    ;;
  open|browser)
    xdg-open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 &
    echo "Abrindo http://127.0.0.1:${PORT} no navegador..."
    ;;
  *)
    echo "Uso: linux-resource {app|window|widget|tray|status|start|stop|restart|logs|open}"
    echo "  app / window : Abre o aplicativo em janela dedicada do Linux (sem abas de navegador)"
    echo "  widget       : Detecta GNOME ou KDE Plasma e ativa o widget na barra do sistema
  tray         : Inicia o ícone de bandeja do sistema (system tray)"
    echo "  status/logs  : Consulta o servico systemd"
    echo "  open         : Abre em uma aba do navegador padrao (http://127.0.0.1:${PORT})"
    exit 1
    ;;
esac
EOF
chmod 0755 "$STAGE_DIR/usr/bin/$PKG_NAME"

# Atalho Desktop (.desktop) -> abre a janela dedicada nativa (sem barra de navegador)
cat > "$STAGE_DIR/usr/share/applications/org.linuxresource.app.desktop" <<'EOF'
[Desktop Entry]
Name=Linux Resource
Comment=Console nativo de telemetria, gerenciamento e otimização para Linux
Exec=/usr/bin/linux-resource-window
Icon=linux-resource
Terminal=false
Type=Application
StartupNotify=true
StartupWMClass=org.linuxresource.app
Categories=System;Monitor;Utility;
Keywords=linux;monitor;disk;docker;ssh;process;memory;network;gpu;nginx;procman;pm2;
Actions=OpenBrowser;EnableWidget;

[Desktop Action OpenBrowser]
Name=Abrir no Navegador Web
Exec=xdg-open http://127.0.0.1:10450

[Desktop Action EnableWidget]
Name=Ativar Widget na Barra (GNOME / KDE)
Exec=/usr/bin/linux-resource-desktop-setup
EOF

# Autostart XDG universal: detecta se o login gráfico é GNOME ou KDE Plasma e ativa o widget correspondente
cat > "$STAGE_DIR/etc/xdg/autostart/$PKG_NAME-widget.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Linux Resource Bar Widget (GNOME & KDE)
Comment=Detecta GNOME ou KDE Plasma e ativa o widget de telemetria na barra do sistema
Exec=/usr/bin/linux-resource-desktop-setup
OnlyShowIn=GNOME;KDE;ubuntu;pop;
NoDisplay=true
X-GNOME-Autostart-enabled=true
EOF


# Autostart XDG do ícone de bandeja: inicia junto com a sessão gráfica do usuário
cat > "$STAGE_DIR/etc/xdg/autostart/$PKG_NAME-tray.desktop" <<'DESKEOF'
[Desktop Entry]
Type=Application
Name=Linux Resource (bandeja do sistema)
Comment=Ícone na bandeja com status, menu de clique direito e alerta de atualização
Exec=/usr/bin/linux-resource-tray
Icon=linux-resource
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
X-KDE-autostart-after=panel
DESKEOF

# Calcula tamanho instalado em KB
INSTALLED_SIZE="$(du -sk "$STAGE_DIR" | awk '{print $1}')"

cat > "$STAGE_DIR/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $VERSION
Section: admin
Priority: optional
Architecture: $ARCH
Installed-Size: $INSTALLED_SIZE
Depends: coreutils, iputils-ping, openssh-client
Recommends: nodejs (>= 22.5.0), docker.io | docker-ce | docker-ce-cli, nginx, sshpass, pciutils, python3-pyqt6 | python3-pyqt5 | gir1.2-ayatanaappindicator3-0.1, gnome-shell-extension-appindicator
Suggests: python3-gi, gir1.2-webkit-6.0 | gir1.2-webkit2-4.1, gnome-shell, plasma-workspace
Maintainer: Raony <rcostamelo@gmail.com>
Homepage: https://github.com/rcostamelo/linuxresourse
Description: Aplicativo e console de telemetria, gerenciamento e otimizacao para Linux
 Linux Resource e um aplicativo desktop/servidor moderno (Mission Control)
 para monitorar, gerenciar e otimizar desktops e servidores Linux.
 .
 Funciona em janela dedicada nativa no Linux (WebKitGTK ou App Window) e também
 via navegador web, além de incluir widgets nativos para GNOME Shell e KDE Plasma.
 Suporta Node.js via apt (/usr/bin/node) ou instalado via NVM/FNM/Volta.
 .
 Recursos incluidos:
  - Janela dedicada de aplicativo Linux (/usr/bin/linux-resource-window) sem abas/barra de navegador
  - Widgets nativos para barra do GNOME Shell e painel do KDE Plasma (deteccao automatica)
  - 4 Temas visuais (Padrao Mission Control, Retro P&B, Claro P&B e Monokai) e navegacao categorizada
  - Dashboard em tempo real (CPU com temperatura, RAM, GPU dedicada, Load, Rede e Pool de Discos)
  - Plugin Multi-Usuario para Procman (procmand) e PM2 (supervisao global de root e /home/*)
  - Telemetria automatica e relatorio completo de GPU dedicada (ocultando iGPUs integradas)
  - Gerenciador completo do servidor Nginx (controle de servico, nginx -t, virtual hosts, editor e logs)
  - Explorador de multiplos discos fisicos e particoes com Treemap interativo
  - Monitor de rede (IP principal do host, interfaces, trafego, latencia e conexoes TCP ativas)
  - Gerenciamento de containers e imagens Docker (logs, inspect, prune)
  - Monitoramento multi-servidor via SSH (clusters, historico, runbooks, host key e auditoria)
  - Gerenciamento CRUD de usuarios do sistema operacional e Cofre Sudo (AES-256-GCM)
EOF

cat > "$STAGE_DIR/DEBIAN/conffiles" <<'EOF'
/etc/default/linux-resource
EOF

cat > "$STAGE_DIR/DEBIAN/postinst" <<'EOF'
#!/usr/bin/env bash
set -e

mkdir -p /var/lib/linux-resource
chmod 0700 /var/lib/linux-resource

# Endpoint do widget é somente local (loopback), sem token. Remove resíduos de versões antigas.
rm -f /etc/linux-resource/widget.env /etc/linux-resource/widget-token

# Versões antigas criavam este segundo ID como alias do mesmo aplicativo.
legacy_launcher=/usr/share/applications/linux-resource.desktop
if [ -L "$legacy_launcher" ] && [ "$(readlink "$legacy_launcher")" = org.linuxresource.app.desktop ]; then
  rm -f "$legacy_launcher"
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications || true
fi

docker_backend_running() {
  command -v docker >/dev/null 2>&1 || return 1

  # O compose deste projeto usa o serviço "linux-resource" tanto no modo
  # padrão quanto no modo host. Se já houver um container ativo, o .deb fica
  # responsável apenas pela integração desktop e não inicia outro backend.
  if docker ps --filter 'label=com.docker.compose.service=linux-resource' --format '{{.ID}}' 2>/dev/null | grep -q .; then
    return 0
  fi

  for name in linux-resource linux-resource-host; do
    if docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null | grep -qx true; then
      return 0
    fi
  done
  return 1
}

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  if docker_backend_running; then
    systemctl disable --now linux-resource.service >/dev/null 2>&1 || true
    echo "Container Linux Resource ativo: mantendo o backend Docker e não iniciando o serviço do .deb."
  else
    systemctl enable linux-resource.service >/dev/null 2>&1 || true
    systemctl restart linux-resource.service >/dev/null 2>&1 || true
  fi
fi

echo ""
echo "=================================================================="
echo " Linux Resource instalado com sucesso!"
echo " Abrir aplicativo nativo: linux-resource app"
echo " Ativar widget (GNOME/KDE): linux-resource widget"
echo " Acesso via navegador:    http://localhost:10450"
echo " Comandos do servico:     linux-resource {status|logs|restart}"
echo "=================================================================="
echo ""
EOF
chmod 0755 "$STAGE_DIR/DEBIAN/postinst"

cat > "$STAGE_DIR/DEBIAN/prerm" <<'EOF'
#!/usr/bin/env bash
set -e

if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    systemctl stop linux-resource.service >/dev/null 2>&1 || true
    systemctl disable linux-resource.service >/dev/null 2>&1 || true
  fi
fi
EOF
chmod 0755 "$STAGE_DIR/DEBIAN/prerm"

cat > "$STAGE_DIR/DEBIAN/postrm" <<'EOF'
#!/usr/bin/env bash
set -e

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
fi

if [ "$1" = "purge" ]; then
  rm -rf /var/lib/linux-resource /etc/linux-resource
fi
EOF
chmod 0755 "$STAGE_DIR/DEBIAN/postrm"

mkdir -p "$OUT_DIR"
echo "==> [3/4] Empacotando .deb com dpkg-deb..."
dpkg-deb --root-owner-group --build "$STAGE_DIR" "$DEB_FILE"

echo "==> [4/4] Gerando SHA256SUMS..."
(cd "$OUT_DIR" && sha256sum "$(basename "$DEB_FILE")" > SHA256SUMS)

echo "Pacote gerado em: $DEB_FILE"
ls -lh "$DEB_FILE" "$OUT_DIR/SHA256SUMS"
