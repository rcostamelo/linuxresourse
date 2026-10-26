#!/usr/bin/env bash
# Detecta automaticamente se a sessão gráfica atual é GNOME ou KDE Plasma
# e ativa o respectivo widget de barra superior/painel do Linux Resource.
set -euo pipefail

GNOME_UUID="linux-resource-widget@linuxresource.local"
KDE_ID="org.linuxresource.widget"

DE="$(printf '%s %s %s' "${XDG_CURRENT_DESKTOP:-}" "${DESKTOP_SESSION:-}" "${XDG_SESSION_DESKTOP:-}" | tr '[:upper:]' '[:lower:]')"

setup_gnome() {
  if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$GNOME_UUID" >/dev/null 2>&1 || true
  fi
}

setup_kde() {
  local src_dir="/usr/share/plasma/plasmoids/${KDE_ID}"
  if [ ! -d "$src_dir" ]; then
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    if [ -d "$script_dir/widget/kde-plasmoid/${KDE_ID}" ]; then
      src_dir="$script_dir/widget/kde-plasmoid/${KDE_ID}"
    fi
  fi

  # Garante que o pacote está instalado para o usuário caso não esteja em /usr/share/plasma/plasmoids
  if [ -d "$src_dir" ] && [ ! -d "/usr/share/plasma/plasmoids/${KDE_ID}" ] && [ ! -d "${HOME}/.local/share/plasma/plasmoids/${KDE_ID}" ]; then
    if command -v kpackagetool6 >/dev/null 2>&1; then
      kpackagetool6 -t Plasma/Applet -i "$src_dir" >/dev/null 2>&1 || true
    elif command -v kpackagetool5 >/dev/null 2>&1; then
      kpackagetool5 -t Plasma/Applet -i "$src_dir" >/dev/null 2>&1 || true
    else
      mkdir -p "${HOME}/.local/share/plasma/plasmoids"
      cp -r "$src_dir" "${HOME}/.local/share/plasma/plasmoids/${KDE_ID}"
    fi
  fi

  # Só adiciona ao painel se o plasmoid realmente existir no sistema ou no diretório do usuário
  if [ ! -d "/usr/share/plasma/plasmoids/${KDE_ID}" ] && [ ! -d "${HOME}/.local/share/plasma/plasmoids/${KDE_ID}" ]; then
    return 0
  fi

  local marker="${XDG_CONFIG_HOME:-$HOME/.config}/linux-resource-kde-widget-installed"
  if [ ! -f "$marker" ]; then
    local qdbus_bin=""
    for b in qdbus6 qdbus-qt6 qdbus; do
      if command -v "$b" >/dev/null 2>&1; then
        qdbus_bin="$b"
        break
      fi
    done

    if [ -n "$qdbus_bin" ]; then
      "$qdbus_bin" org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript "
        var allPanels = panels();
        var exists = false;
        for (var i = 0; i < allPanels.length; i++) {
          var w = allPanels[i].widgets();
          for (var j = 0; j < w.length; j++) {
            if (w[j].type === '${KDE_ID}') { exists = true; break; }
          }
        }
        if (!exists && allPanels.length > 0) {
          allPanels[0].addWidget('${KDE_ID}');
        }
      " >/dev/null 2>&1 || true
      mkdir -p "$(dirname "$marker")"
      touch "$marker"
    fi
  fi
}

if [[ "$DE" == *"gnome"* ]] || [[ "$DE" == *"ubuntu"* ]] || [[ "$DE" == *"pop"* ]]; then
  setup_gnome
elif [[ "$DE" == *"kde"* ]] || [[ "$DE" == *"plasma"* ]]; then
  setup_kde
else
  # Fallback caso variáveis XDG não estejam preenchidas
  if pgrep -x "gnome-shell" >/dev/null 2>&1; then
    setup_gnome
  elif pgrep -x "plasmashell" >/dev/null 2>&1; then
    setup_kde
  fi
fi

# Inicia o ícone de bandeja (single-instance; ignora se já estiver rodando)
for tray_bin in /usr/bin/linux-resource-tray "${HOME}/.local/share/bin/linux-resource-tray" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/linux-resource-tray.py"; do
  if [ -x "$tray_bin" ]; then
    nohup "$tray_bin" >/dev/null 2>&1 &
    break
  fi
done

