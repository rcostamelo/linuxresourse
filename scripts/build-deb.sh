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
  "$STAGE_DIR/usr/share/gnome-shell/extensions" \
  "$STAGE_DIR/etc/xdg/autostart" \
  "$STAGE_DIR/var/lib/$PKG_NAME"

cp -r "$ROOT_DIR/dist" "$STAGE_DIR/opt/$PKG_NAME/dist"
cp -r "$ROOT_DIR/server" "$STAGE_DIR/opt/$PKG_NAME/server"
cp "$ROOT_DIR/package.json" "$STAGE_DIR/opt/$PKG_NAME/package.json"
[ -f "$ROOT_DIR/LICENSE" ] && cp "$ROOT_DIR/LICENSE" "$STAGE_DIR/opt/$PKG_NAME/LICENSE"
[ -f "$ROOT_DIR/README.md" ] && cp "$ROOT_DIR/README.md" "$STAGE_DIR/opt/$PKG_NAME/README.md"
[ -f "$ROOT_DIR/public/logo-mark.png" ] && cp "$ROOT_DIR/public/logo-mark.png" "$STAGE_DIR/usr/share/pixmaps/$PKG_NAME.png"

# Widget de desktop (extensão GNOME Shell), instalado para todos os usuários
WIDGET_UUID="linux-resource-widget@linuxresource.local"
cp -r "$ROOT_DIR/widget/gnome-extension/$WIDGET_UUID" "$STAGE_DIR/usr/share/gnome-shell/extensions/$WIDGET_UUID"

# Arquivo de configuração em /etc/default/linux-resource
cat > "$STAGE_DIR/etc/default/$PKG_NAME" <<'EOF'
# Configuração do serviço Linux Resource
HOST=0.0.0.0
PORT=10450
DATA_DIR=/var/lib/linux-resource
# TRUST_PROXY=0
EOF

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
EnvironmentFile=-/etc/linux-resource/widget.env
WorkingDirectory=/opt/linux-resource
ExecStart=/usr/bin/env node --disable-warning=ExperimentalWarning /opt/linux-resource/server/index.js
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

cmd="${1:-status}"
case "$cmd" in
  status)
    systemctl status linux-resource.service --no-pager
    ;;
  start|stop|restart|reload)
    sudo systemctl "$cmd" linux-resource.service
    ;;
  logs)
    journalctl -u linux-resource.service -f -n 100
    ;;
  open)
    xdg-open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 &
    echo "Abrindo http://127.0.0.1:${PORT} ..."
    ;;
  *)
    echo "Uso: linux-resource {status|start|stop|restart|logs|open}"
    echo "Console web disponível em: http://127.0.0.1:${PORT}"
    exit 1
    ;;
esac
EOF
chmod 0755 "$STAGE_DIR/usr/bin/$PKG_NAME"

# Atalho Desktop (.desktop)
cat > "$STAGE_DIR/usr/share/applications/$PKG_NAME.desktop" <<'EOF'
[Desktop Entry]
Name=Linux Resource
Comment=Console de telemetria, gerenciamento e otimização para Linux
Exec=xdg-open http://127.0.0.1:10450
Icon=linux-resource
Terminal=false
Type=Application
Categories=System;Monitor;Utility;
Keywords=linux;monitor;disk;docker;ssh;process;memory;network;gpu;
EOF

# Autostart: ativa o widget na sessão GNOME de cada usuário no login.
# gnome-extensions enable apenas acrescenta a extensão à lista, sem apagar as outras.
cat > "$STAGE_DIR/etc/xdg/autostart/$PKG_NAME-widget.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Linux Resource Widget
Comment=Ativa o widget de telemetria na barra superior do GNOME
Exec=gnome-extensions enable $WIDGET_UUID
OnlyShowIn=GNOME;
NoDisplay=true
X-GNOME-Autostart-enabled=true
EOF

# Calcula tamanho instalado em KB
INSTALLED_SIZE="$(du -sk "$STAGE_DIR" | awk '{print $1}')"

cat > "$STAGE_DIR/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $VERSION
Section: admin
Priority: optional
Architecture: $ARCH
Installed-Size: $INSTALLED_SIZE
Depends: nodejs (>= 22.5.0), coreutils, iputils-ping, openssh-client
Recommends: docker.io | docker-ce | docker-ce-cli, sshpass, pciutils, gnome-shell
Maintainer: Raony <rcostamelo@gmail.com>
Homepage: https://github.com/rcostamelo/linuxresourse
Description: Console web de telemetria, gerenciamento e otimizacao para Linux
 Linux Resource e um console web moderno (Mission Control / Cyber-Telemetry)
 para monitorar, gerenciar e otimizar desktops e servidores Linux.
 .
 Recursos incluidos:
  - Dashboard em tempo real (CPU, RAM, GPU, Load, Rede e Pool de Discos)
  - Telemetria automatica e relatorio completo de GPU (NVIDIA, AMD e Intel)
  - Explorador de multiplos discos fisicos e particoes com Treemap interativo
  - Monitor de rede (interfaces, trafego, latencia e conexoes TCP ativas)
  - Gerenciamento de containers e imagens Docker (logs, inspect, prune)
  - Monitoramento multi-servidor via SSH (clusters, historico, runbooks, host key e auditoria)
  - Gerenciamento CRUD de usuarios do sistema operacional e Cofre Sudo (AES-256-GCM)
  - Gerenciador de processos, detalhamento de memoria/swap e limpeza segura
  - Widget de desktop GNOME na barra superior (CPU, RAM, rede), opcional
EOF

cat > "$STAGE_DIR/DEBIAN/conffiles" <<'EOF'
/etc/default/linux-resource
EOF

cat > "$STAGE_DIR/DEBIAN/postinst" <<'EOF'
#!/usr/bin/env bash
set -e

mkdir -p /var/lib/linux-resource
chmod 0700 /var/lib/linux-resource

# Token do widget: gerado só na primeira instalação (upgrades preservam o existente)
if [ ! -f /etc/linux-resource/widget.env ]; then
  mkdir -p /etc/linux-resource
  chmod 0755 /etc/linux-resource
  token="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  printf 'WIDGET_TOKEN=%s\n' "$token" > /etc/linux-resource/widget.env
  chmod 0600 /etc/linux-resource/widget.env
  printf '%s' "$token" > /etc/linux-resource/widget-token
  chmod 0644 /etc/linux-resource/widget-token
fi

if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable linux-resource.service >/dev/null 2>&1 || true
  systemctl restart linux-resource.service >/dev/null 2>&1 || true
fi

echo ""
echo "=================================================================="
echo " Linux Resource instalado com sucesso!"
echo " Acesse no navegador: http://localhost:10450"
echo " Comandos rapidos:    linux-resource {status|logs|restart|open}"
echo " Configuracao:        /etc/default/linux-resource"
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
