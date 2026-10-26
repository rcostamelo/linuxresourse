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
  local marker="${XDG_CONFIG_HOME:-$HOME/.config}/linux-resource-kde-widget-installed"
  # O plasmoid já fica registrado em /usr/share/plasma/plasmoids/org.linuxresource.widget
  # Se qdbus/qdbus6 estiver disponível e for o primeiro login, adiciona ao painel padrão do Plasma se ainda não estiver presente
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
