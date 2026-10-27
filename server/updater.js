import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './config.js';
import { IS_HOST_MOUNT, hostPath, getSudoStatus, execHostSudo, detectPrimaryHostUser, readPasswdUsers } from './osUsers.js';
import { recordSshAudit } from './db.js';

const GITHUB_REPO = 'rcostamelo/linuxresourse';
const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=15`;

let releasesCache = {
  ts: 0,
  items: [],
  error: null,
};

let updateJob = {
  running: false,
  status: 'idle', // 'idle' | 'running' | 'success' | 'error'
  startedAt: null,
  finishedAt: null,
  targetVersion: null,
  mode: null,
  step: '',
  logs: [],
  error: null,
};

function appendJobLog(line) {
  const ts = new Date().toISOString().slice(11, 19);
  updateJob.logs.push(`[${ts}] ${line}`);
  if (updateJob.logs.length > 300) {
    updateJob.logs.shift();
  }
}

function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function execLocal(bin, args, { timeout = 15000, cwd = undefined } = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024, cwd }, (err, stdout, stderr) => {
      resolve({
        code: typeof err?.code === 'number' ? err.code : err ? 1 : 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: err ? String(err.message || err) : null,
      });
    });
  });
}

export function getCurrentVersion() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return String(pkg.version || '0.0.0').replace(/^v/i, '');
  } catch {
    return '0.0.0';
  }
}

export function compareSemver(a, b) {
  const pa = String(a || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Detecta como o Linux Resource foi instalado e qual o ambiente gráfico do host.
 */
export async function detectInstallEnvironment() {
  const isDebInstalled =
    existsSync(hostPath('/opt/linux-resource/package.json')) ||
    existsSync(hostPath('/lib/systemd/system/linux-resource.service'));

  const isDockerContainer = IS_HOST_MOUNT || existsSync('/.dockerenv');

  let desktopVersion = null;
  try {
    const pkg = JSON.parse(readFileSync(hostPath('/opt/linux-resource/package.json'), 'utf8'));
    if (pkg.name === 'linux-resource' && pkg.version) desktopVersion = String(pkg.version);
  } catch {
    /* O pacote pode estar ausente ou sua versão indisponível. */
  }

  // Procura repositório git caso esteja rodando em container ou local
  let gitRepoDir = null;
  let composeProject = null;
  let composeFiles = [];
  if (existsSync(path.join(ROOT, '.git'))) {
    gitRepoDir = ROOT;
  } else if (isDockerContainer) {
    // Os rótulos do Compose guardam o caminho real, inclusive em /mnt ou /media.
    const template = '{{.State.Running}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project"}}';
    const listed = await execLocal('docker', ['ps', '--filter', 'label=com.docker.compose.service=linux-resource', '--format', '{{.Names}}'], { timeout: 5000 });
    const containers = [...new Set([
      ...(listed.code === 0 ? listed.stdout.split('\n').map((name) => name.trim()).filter(Boolean) : []),
      'linux-resource', 'linux-resource-host',
    ])];
    const matches = [];
    for (const container of containers) {
      const inspected = await execLocal('docker', ['inspect', '--format', template, container], { timeout: 5000 });
      const [running, dir, files, project] = inspected.stdout.trim().split('|');
      if (inspected.code !== 0 || running !== 'true' || !dir || !path.isAbsolute(dir)) continue;
      try {
        const pkg = JSON.parse(readFileSync(hostPath(path.join(dir, 'package.json')), 'utf8'));
        if (pkg.name !== 'linux-resource' || !existsSync(hostPath(path.join(dir, '.git')))) continue;
        matches.push({
          dir,
          project: project && project !== '<no value>' ? project : null,
          files: (files && files !== '<no value>' ? files.split(',') : []).filter((file) => path.isAbsolute(file)),
        });
      } catch {
        /* Continua procurando outros containers ou o repositório no host. */
      }
    }
    if (matches.length === 1) {
      ({ dir: gitRepoDir, project: composeProject, files: composeFiles } = matches[0]);
    }
  }

  // Determinação precisa do modo de instalação:
  // Se estamos executando dentro do container Docker, a atualização deste processo é SEMPRE Docker
  let installMode = 'standalone';
  if (isDockerContainer) {
    installMode = 'docker-git';
  } else if (isDebInstalled) {
    installMode = 'deb';
  } else if (gitRepoDir) {
    installMode = 'git';
  }

  // Detecta Desktop Environment no host (KDE Plasma vs GNOME vs Headless Server)
  let desktopEnv = 'Headless / Servidor';
  try {
    const psOut = await execLocal('ps', ['-eo', 'comm']);
    const procs = psOut.stdout;
    if (procs.includes('plasmashell') || procs.includes('kwin_wayland') || procs.includes('kwin_x11')) {
      desktopEnv = 'KDE Plasma';
    } else if (procs.includes('gnome-shell')) {
      desktopEnv = 'GNOME Shell';
    }
  } catch {
    /* ignore */
  }

  const kdeWidgetInstalled =
    existsSync(hostPath('/usr/share/plasma/plasmoids/org.linuxresource.widget'));

  const gnomeWidgetInstalled = existsSync(
    hostPath('/usr/share/gnome-shell/extensions/linux-resource-widget@linuxresource.local')
  );

  const desktopLauncherInstalled =
    existsSync(hostPath('/usr/share/applications/org.linuxresource.app.desktop')) ||
    existsSync(hostPath('/usr/share/applications/linux-resource.desktop'));

  return {
    installMode,
    isDebInstalled,
    desktopVersion,
    isDockerContainer,
    gitRepoDir,
    composeProject,
    composeFiles,
    desktopEnv,
    kdeWidgetInstalled,
    gnomeWidgetInstalled,
    desktopLauncherInstalled,
    nodeVersion: process.version,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    hostname: os.hostname(),
  };
}

export async function fetchGitHubReleases({ force = false } = {}) {
  if (!force && releasesCache.ts > 0 && Date.now() - releasesCache.ts < 60_000 && releasesCache.items.length > 0) {
    return releasesCache;
  }

  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Linux-Resource-Updater',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}`);
    }

    const data = await res.json();
    const items = (Array.isArray(data) ? data : []).map((rel) => {
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      const debAsset = assets.find((a) => String(a.name || '').endsWith('.deb'));
      const checksumAsset = assets.find((a) => a.name === 'SHA256SUMS');
      return {
        id: rel.id,
        tagName: String(rel.tag_name || ''),
        version: String(rel.tag_name || '').replace(/^v/i, ''),
        name: String(rel.name || rel.tag_name || ''),
        body: String(rel.body || ''),
        publishedAt: rel.published_at || rel.created_at || null,
        htmlUrl: rel.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${rel.tag_name}`,
        prerelease: Boolean(rel.prerelease),
        debAsset: debAsset
          ? {
              name: debAsset.name,
              size: Number(debAsset.size) || 0,
              downloadUrl: debAsset.browser_download_url,
            }
          : null,
        checksumUrl: checksumAsset?.browser_download_url || null,
      };
    });

    releasesCache = {
      ts: Date.now(),
      items,
      error: null,
    };
  } catch (err) {
    releasesCache = {
      ts: Date.now(),
      items: releasesCache.items || [],
      error: String(err.message || err),
    };
  }

  return releasesCache;
}

export async function getSystemAboutOverview({ force = false } = {}) {
  const currentVersion = getCurrentVersion();
  const [envInfo, relData, sudo] = await Promise.all([
    detectInstallEnvironment(),
    fetchGitHubReleases({ force }),
    getSudoStatus(),
  ]);

  const latestRelease = relData.items.find((r) => !r.prerelease) || relData.items[0] || null;
  const latestVersion = latestRelease ? latestRelease.version : currentVersion;
  const backendUpdateAvailable = latestRelease ? compareSemver(latestVersion, currentVersion) > 0 : false;
  const desktopUpdateAvailable = Boolean(latestRelease && envInfo.isDebInstalled && envInfo.desktopVersion &&
    compareSemver(latestVersion, envInfo.desktopVersion) > 0);
  const updateAvailable = backendUpdateAvailable || desktopUpdateAvailable;

  return {
    ts: Date.now(),
    currentVersion,
    latestVersion,
    updateAvailable,
    backendUpdateAvailable,
    desktopUpdateAvailable,
    latestRelease,
    releases: relData.items,
    releasesError: relData.error,
    environment: envInfo,
    sudo,
    updateJob,
    repoUrl: `https://github.com/${GITHUB_REPO}`,
  };
}


/**
 * Resumo leve para widgets/bandeja (sem dados de sudo/ambiente pesados).
 * `force` ignora o cache do GitHub, mas no máximo 1 vez a cada 30s para não estourar o rate-limit.
 */
let lastForcedAt = 0;
export async function getUpdateSummary({ force = false } = {}) {
  const doForce = force && Date.now() - lastForcedAt > 30_000;
  if (doForce) lastForcedAt = Date.now();
  const currentVersion = getCurrentVersion();
  const relData = await fetchGitHubReleases({ force: doForce });
  const latest = relData.items.find((r) => !r.prerelease) || relData.items[0] || null;
  const latestVersion = latest ? latest.version : currentVersion;
  let desktopVersion = null;
  try {
    const pkg = JSON.parse(readFileSync(hostPath('/opt/linux-resource/package.json'), 'utf8'));
    if (pkg.name === 'linux-resource' && pkg.version) desktopVersion = String(pkg.version);
  } catch { /* pacote desktop ausente */ }
  return {
    ts: Date.now(),
    currentVersion,
    latestVersion,
    updateAvailable: latest ? compareSemver(latestVersion, currentVersion) > 0 ||
      Boolean(desktopVersion && compareSemver(latestVersion, desktopVersion) > 0) : false,
    releaseName: latest?.name || null,
    releaseUrl: latest?.htmlUrl || null,
    error: relData.error || null,
  };
}

export function desktopInstallCommand(release) {
  const asset = release.debAsset;
  const expectedName = `linux-resource_${release.version}_all.deb`;
  if (!asset || asset.name !== expectedName || !release.checksumUrl) {
    throw new Error(`A release v${release.version} precisa conter ${expectedName} e SHA256SUMS.`);
  }
  const primary = !IS_HOST_MOUNT && process.getuid?.() === 0
    ? readPasswdUsers().find((user) => user.uid === 1000 && user.home?.startsWith('/home/')) || detectPrimaryHostUser()
    : detectPrimaryHostUser();
  return `
    tmp_dir=$(mktemp -d /tmp/linux-resource-update.XXXXXXXX)
    trap 'rm -f "$tmp_dir"/${shQuote(expectedName)} "$tmp_dir"/SHA256SUMS; rmdir "$tmp_dir" 2>/dev/null || true' EXIT
    download() {
      if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
      elif command -v wget >/dev/null 2>&1; then wget -q -O "$2" "$1"
      else echo 'curl ou wget é necessário para baixar a atualização.' >&2; return 1; fi
    }
    download ${shQuote(asset.downloadUrl)} "$tmp_dir"/${shQuote(expectedName)}
    download ${shQuote(release.checksumUrl)} "$tmp_dir"/SHA256SUMS
    (cd "$tmp_dir" && sha256sum --check SHA256SUMS)
    # A bandeja e a extensão GNOME são opcionais e podem não existir nos
    # repositórios do host. Não devem impedir a atualização do pacote principal.
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$tmp_dir"/${shQuote(expectedName)}
    installed=$(dpkg-query -W -f='\${Version}' linux-resource)
    [ "$installed" = ${shQuote(release.version)} ] || { echo 'A versão do pacote instalado não corresponde à release.' >&2; exit 1; }
    if [ -x /usr/bin/linux-resource-desktop-setup ] && id ${shQuote(primary.username)} >/dev/null 2>&1; then
      runuser -u ${shQuote(primary.username)} -- env HOME=${shQuote(primary.home)} /usr/bin/linux-resource-desktop-setup --sync-only
    fi
  `;
}

export function dockerUpdateCommand(env, release, installDesktop) {
  if (!env.gitRepoDir || !env.composeProject || !env.composeFiles?.length) {
    throw new Error('Não foi possível identificar o repositório e os arquivos do Docker Compose em execução.');
  }
  if (!/^v?\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(release.tagName)) {
    throw new Error('A tag da release não é válida para atualização.');
  }
  const repo = shQuote(env.gitRepoDir);
  const tag = shQuote(`refs/tags/${release.tagName}^{commit}`);
  const composeArgs = [
    '--project-directory', env.gitRepoDir,
    '--project-name', env.composeProject,
    ...env.composeFiles.flatMap((file) => ['-f', file]),
  ].map(shQuote).join(' ');
  return `
    set -e
    cd ${repo}
    repo_owner=$(stat -c '%U' .git)
    id "$repo_owner" >/dev/null 2>&1 || { echo 'Não foi possível identificar o proprietário do repositório.' >&2; exit 1; }
    git_user() { runuser -u "$repo_owner" -- git -C ${repo} "$@"; }
    branch=$(git_user symbolic-ref --quiet --short HEAD || true)
    [ "$branch" = main ] || { echo 'A atualização automática exige a branch main; a branch atual foi preservada.' >&2; exit 1; }
    [ -z "$(git_user status --porcelain --untracked-files=no)" ] || { echo 'O repositório contém alterações locais; salve-as antes de atualizar.' >&2; exit 1; }
    git_user fetch origin --tags
    git_user merge-base --is-ancestor HEAD ${tag} || { echo 'A release não permite atualização fast-forward; o repositório foi preservado.' >&2; exit 1; }
    git_user merge --ff-only ${tag}
    ${installDesktop ? desktopInstallCommand(release) : ''}
    repo_home=$(getent passwd "$repo_owner" | cut -d: -f6)
    [ -n "$repo_home" ] || { echo 'Não foi possível localizar o diretório do usuário do repositório.' >&2; exit 1; }
    HOME="$repo_home" docker compose ${composeArgs} up -d --build
  `;
}

export function nativeDebUpdateCommand(release, unit) {
  const script = `set -e\n${desktopInstallCommand(release)}`;
  return `command -v systemd-run >/dev/null 2>&1 || { echo 'systemd-run é necessário para atualizar o serviço em execução.' >&2; exit 1; }\n` +
    `systemd-run --quiet --wait --collect --unit=${shQuote(unit)} /bin/sh -c ${shQuote(script)}`;
}

/**
 * Dispara a atualização em segundo plano de acordo com o modo de instalação (Pacote .deb ou Git/Docker).
 */
export async function triggerSystemUpdate(input = {}, actor = {}) {
  if (updateJob.running) {
    return {
      ok: true,
      alreadyRunning: true,
      updateJob,
    };
  }

  const overview = await getSystemAboutOverview({ force: true });
  const targetRelease =
    (input.tagName && overview.releases.find((r) => r.tagName === input.tagName || r.version === input.tagName)) ||
    overview.latestRelease;

  if (!targetRelease) {
    throw new Error('Nenhuma release encontrada no GitHub para atualização.');
  }

  const env = overview.environment;
  if (compareSemver(targetRelease.version, overview.currentVersion) < 0 ||
      (env.desktopVersion && compareSemver(targetRelease.version, env.desktopVersion) < 0)) {
    throw new Error('A versão escolhida é anterior à versão instalada. O sistema não faz downgrade automático.');
  }
  const installDesktop = env.isDebInstalled && (!env.desktopVersion ||
    compareSemver(targetRelease.version, env.desktopVersion) > 0 || env.installMode === 'deb');
  const rebuildDocker = env.isDockerContainer &&
    (compareSemver(targetRelease.version, overview.currentVersion) > 0 || !installDesktop);
  if (rebuildDocker && input.confirmContainer !== true) {
    throw new Error('Confirme a substituição do container para continuar a atualização.');
  }
  if (installDesktop && (!targetRelease.debAsset || !targetRelease.checksumUrl)) {
    throw new Error('A release precisa ter o pacote Debian e SHA256SUMS para atualizar o desktop.');
  }
  // Prepare o comando antes de iniciar o job para informar erros de configuração à interface.
  const dockerCommand = rebuildDocker ? dockerUpdateCommand(env, targetRelease, installDesktop) : null;

  updateJob = {
    running: true,
    status: 'running',
    startedAt: Date.now(),
    finishedAt: null,
    targetVersion: targetRelease.version,
    mode: env.installMode,
    step: 'Preparando atualização...',
    logs: [],
    error: null,
  };

  appendJobLog(`Iniciando atualização para v${targetRelease.version} (modo detectado: ${env.installMode})`);

  // Executa de forma assíncrona para retornar o status imediatamente à UI
  (async () => {
    const start = Date.now();
    try {
      if (rebuildDocker) {
        updateJob.step = installDesktop ? 'Atualizando desktop e reconstruindo o container...' : 'Reconstruindo o container Docker...';
        appendJobLog(`Sincronizando ${env.gitRepoDir} por fast-forward e usando o Compose em execução.`);
        if (installDesktop) appendJobLog('O pacote desktop será verificado pelo SHA256 e atualizado antes do container.');
        const r = await execHostSudo(dockerCommand, { timeout: 600000 });
        if (r.error === 'requires_sudo_password') {
          throw new Error('Configure a senha no Cofre Sudo para atualizar o repositório e container no host.');
        }
        if (r.code !== 0) {
          throw new Error((r.stderr || r.stdout || r.error || 'Falha ao atualizar via Git/Docker').trim());
        }
        if (r.stdout.trim()) appendJobLog(r.stdout.trim().slice(-800));
      } else if (installDesktop) {
        updateJob.step = 'Verificando e instalando o pacote desktop...';
        appendJobLog('Baixando o pacote Debian e verificando SHA256SUMS.');
        const installScript = `set -e\n${desktopInstallCommand(targetRelease)}`;
        // Em instalação nativa, o postinst reinicia este serviço. Um serviço
        // transitório mantém apt/dpkg fora do grupo que será interrompido.
        const unit = `linux-resource-update-${Date.now()}`;
        const command = env.installMode === 'deb' && !env.isDockerContainer
          ? nativeDebUpdateCommand(targetRelease, unit)
          : installScript;
        if (env.installMode === 'deb' && !env.isDockerContainer) appendJobLog(`Instalação executada no serviço transitório ${unit}.`);
        const r = await execHostSudo(command, { timeout: 300000 });
        if (r.error === 'requires_sudo_password') {
          throw new Error('Configure a senha no Cofre Sudo para autorizar a instalação do pacote .deb.');
        }
        if (r.code !== 0) {
          throw new Error((r.stderr || r.stdout || r.error || `Falha ao instalar pacote .deb. Consulte journalctl -u ${unit}.`).trim());
        }
        if (r.stdout.trim()) appendJobLog(r.stdout.trim());
      } else if (env.gitRepoDir) {
        const repoDir = env.gitRepoDir;
        updateJob.step = 'Sincronizando repositório Git por fast-forward...';
        appendJobLog(`Atualizando repositório em ${repoDir}...`);
        if (true) {
          const cmd = `
            set -e
            cd ${shQuote(repoDir)}
            [ "$(git symbolic-ref --quiet --short HEAD || true)" = main ] || { echo 'A branch atual foi preservada; use main para atualizar.' >&2; exit 1; }
            [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo 'O repositório contém alterações locais; salve-as antes de atualizar.' >&2; exit 1; }
            git fetch origin --tags
            git merge-base --is-ancestor HEAD ${shQuote(`refs/tags/${targetRelease.tagName}^{commit}`)}
            git merge --ff-only ${shQuote(`refs/tags/${targetRelease.tagName}^{commit}`)}
            npm install --no-audit --no-fund
            npm run build
          `;
          updateJob.step = 'Compilando nova versão...';
          appendJobLog('Executando git pull + npm run build...');
          const r = await execLocal('sh', ['-c', cmd], { timeout: 180000 });
          if (r.code !== 0) {
            throw new Error((r.stderr || r.stdout || r.error || 'Falha ao compilar atualização').trim());
          }
          if (r.stdout.trim()) appendJobLog(r.stdout.trim().slice(-800));
        }
      } else {
        throw new Error('Não foi possível determinar o método de atualização para este ambiente.');
      }

      updateJob.running = false;
      updateJob.status = 'success';
      updateJob.step = `Atualizado com sucesso para v${targetRelease.version}!`;
      updateJob.finishedAt = Date.now();
      appendJobLog(`Atualização concluída com sucesso em ${((Date.now() - start) / 1000).toFixed(1)}s.`);

      recordSshAudit({
        ...actor,
        action: 'system.update',
        detail: `Sistema atualizado para v${targetRelease.version} (${env.installMode})`,
        status: 'ok',
        durationMs: Date.now() - start,
      });
    } catch (err) {
      updateJob.running = false;
      updateJob.status = 'error';
      updateJob.error = String(err.message || err);
      updateJob.step = 'Falha na atualização';
      updateJob.finishedAt = Date.now();
      appendJobLog(`ERRO: ${updateJob.error}`);

      recordSshAudit({
        ...actor,
        action: 'system.update',
        detail: `Falha ao atualizar para v${targetRelease.version}: ${updateJob.error}`,
        status: 'error',
        durationMs: Date.now() - start,
      });
    }
  })();

  return {
    ok: true,
    updateJob,
  };
}
