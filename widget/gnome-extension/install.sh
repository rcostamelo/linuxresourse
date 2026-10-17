#!/usr/bin/env bash
# Instala o widget do Linux Resource como extensão do GNOME Shell (usuário atual).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
uuid="linux-resource-widget@linuxresource.local"
src="$here/$uuid"
dest="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$uuid"

mkdir -p "$dest"
cp "$src/metadata.json" "$src/extension.js" "$dest/"

gnome-extensions enable "$uuid" || echo "Ative manualmente com: gnome-extensions enable $uuid"

cat <<EOF
Instalado em $dest
- Wayland (padrão no Ubuntu 24.04): faça logout e login para carregar a extensão.
- X11: pressione Alt+F2, digite 'r' e Enter.
O painel precisa estar rodando em http://127.0.0.1:10450 (npm start).
EOF
