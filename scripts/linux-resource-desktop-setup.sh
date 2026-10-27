#!/usr/bin/env bash
# Detecta automaticamente se a sessão gráfica atual é GNOME ou KDE Plasma
# e ativa o respectivo widget de barra superior/painel do Linux Resource.
set -euo pipefail

GNOME_UUID="linux-resource-widget@linuxresource.local"
KDE_ID="org.linuxresource.widget"

DE="$(printf '%s %s %s' "${XDG_CURRENT_DESKTOP:-}" "${DESKTOP_SESSION:-}" "${XDG_SESSION_DESKTOP:-}" | tr '[:upper:]' '[:lower:]')"

# Remova somente o alias simbólico criado por versões antigas do pacote.
legacy_launcher="${XDG_DATA_HOME:-$HOME/.local/share}/applications/linux-resource.desktop"
if [ -L "$legacy_launcher" ] && [ "$(readlink "$legacy_launcher")" = "org.linuxresource.app.desktop" ]; then
  rm -f "$legacy_launcher"
fi

sync_gnome_widget() {
  local system_ext="/usr/share/gnome-shell/extensions/${GNOME_UUID}"
  local user_ext="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/${GNOME_UUID}"
  local version_file=".linux-resource-package-version"

  # Uma instalação anterior por usuário tem prioridade sobre /usr/share.
  # Atualize-a uma vez por versão e guarde uma cópia antes de substituí-la.
  if [ -d "$user_ext" ] && [ -f "$system_ext/$version_file" ] && \
     ! cmp -s "$system_ext/$version_file" "$user_ext/$version_file"; then
    if ! cmp -s "$system_ext/extension.js" "$user_ext/extension.js" || \
       ! cmp -s "$system_ext/metadata.json" "$user_ext/metadata.json"; then
      local backup_root="${XDG_DATA_HOME:-$HOME/.local/share}/linux-resource/gnome-widget-backups"
      local backup_dir
      mkdir -p "$backup_root"
      backup_dir="$(mktemp -d "$backup_root/widget-XXXXXXXX")"
      cp -a "$user_ext" "$backup_dir/extension"
      install -m 0644 "$system_ext/extension.js" "$user_ext/extension.js"
      install -m 0644 "$system_ext/metadata.json" "$user_ext/metadata.json"
      echo "Widget anterior preservado em: $backup_dir/extension"
      echo "Saia e entre novamente na sessão para carregar o widget atualizado."
    fi
    install -m 0644 "$system_ext/$version_file" "$user_ext/$version_file"
  fi

}

setup_gnome() {
  sync_gnome_widget
  if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "$GNOME_UUID" >/dev/null 2>&1 || true

    # O tray Qt/Ayatana aparece no GNOME por meio da extensão AppIndicator.
    # Preserve a extensão já ativa; se não houver uma, habilite só uma cópia.
    local ext_root ext_dir ext_uuid
    if ! gnome-extensions list --enabled 2>/dev/null | grep -qi appindicator; then
      for ext_root in "/usr/share/gnome-shell/extensions" "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"; do
        for ext_dir in "$ext_root"/*appindicator*; do
          [ -d "$ext_dir" ] || continue
          ext_uuid="${ext_dir##*/}"
          if gnome-extensions enable "$ext_uuid" >/dev/null 2>&1; then
            break 2
          fi
        done
      done
    fi
  fi
}

if [[ "${1:-}" == "--sync-only" ]]; then
  sync_gnome_widget
  exit 0
fi

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

