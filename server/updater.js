import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './config.js';
import { IS_HOST_MOUNT, hostPath, getSudoStatus, execHostSudo } from './osUsers.js';
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

  // Procura repositório git caso esteja rodando em container ou local
  let gitRepoDir = null;
  if (existsSync(path.join(ROOT, '.git'))) {
    gitRepoDir = ROOT;
  } else if (isDockerContainer) {
    // Busca em profundidade até 7 níveis em /home e /root (para achar o projeto em subpastas do host)
    const scanBase = IS_HOST_MOUNT ? '/host' : '';
    const r = await execLocal('sh', [
      '-c',
      `find ${scanBase}/home ${scanBase}/root -maxdepth 7 -name "package.json" 2>/dev/null | head -n 60`,
    ]);
    for (const fullPkg of r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
      try {
        const content = readFileSync(fullPkg, 'utf8');
        if (content.includes('"name": "linux-resource"') || content.includes('"linux-resource"')) {
          const rawDir = path.dirname(fullPkg);
          const gitCheck = path.join(rawDir, '.git');
          if (existsSync(gitCheck)) {
            gitRepoDir = IS_HOST_MOUNT && rawDir.startsWith('/host') ? rawDir.slice(5) : rawDir;
            break;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Determinação precisa do modo de instalação:
  // Se estamos executando dentro do container Docker, a atualização deste processo é SEMPRE Docker
  let installMode = 'standalone';
  if (isDockerContainer) {
    installMode = gitRepoDir ? 'docker-git' : (isDebInstalled ? 'deb' : 'docker-git');
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
    existsSync(hostPath('/usr/share/plasma/plasmoids/org.linuxresource.widget')) ||
    existsSync('/home/raony/.local/share/plasma/plasmoids/org.linuxresource.widget');

  const gnomeWidgetInstalled = existsSync(
    hostPath('/usr/share/gnome-shell/extensions/linux-resource-widget@linuxresource.local')
  );

  const desktopLauncherInstalled =
    existsSync(hostPath('/usr/share/applications/org.linuxresource.app.desktop')) ||
    existsSync(hostPath('/usr/share/applications/linux-resource.desktop')) ||
    existsSync('/home/raony/.local/share/applications/org.linuxresource.app.desktop');

  return {
    installMode,
    isDebInstalled,
    isDockerContainer,
    gitRepoDir,
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
  const updateAvailable = latestRelease ? compareSemver(latestVersion, currentVersion) > 0 : false;

  return {
    ts: Date.now(),
    currentVersion,
    latestVersion,
    updateAvailable,
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
  return {
    ts: Date.now(),
    currentVersion,
    latestVersion,
    updateAvailable: latest ? compareSemver(latestVersion, currentVersion) > 0 : false,
    releaseName: latest?.name || null,
    releaseUrl: latest?.htmlUrl || null,
    error: relData.error || null,
  };
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
      if (env.installMode === 'docker-git' || (env.isDockerContainer && env.gitRepoDir)) {
        const repoDir = env.gitRepoDir;
        updateJob.step = 'Sincronizando repositório Git (fetch & reset)...';
        appendJobLog(`Atualizando repositório em ${repoDir}...`);

        const cmd = `
          set -e
          cd ${shQuote(repoDir)}
          git fetch origin --tags
          git reset --hard origin/main
          if [ -x scripts/linux-resource-desktop-setup.sh ]; then
            ./scripts/linux-resource-desktop-setup.sh || true
          fi
          docker compose up -d --build
        `;
        updateJob.step = 'Reconstruindo container Docker e atualizando widgets...';
        appendJobLog('Executando git reset --hard origin/main && docker compose up -d --build...');
        const r = await execHostSudo(cmd, { timeout: 180000 });
        if (r.error === 'requires_sudo_password') {
          throw new Error('Configure a senha no Cofre Sudo para atualizar o repositório e container no host.');
        }
        if (r.code !== 0) {
          throw new Error((r.stderr || r.stdout || r.error || 'Falha ao atualizar via Git/Docker').trim());
        }
        if (r.stdout.trim()) appendJobLog(r.stdout.trim().slice(-800));
      } else if (env.installMode === 'deb' || targetRelease.debAsset) {
        const debUrl = targetRelease.debAsset?.downloadUrl;
        if (!debUrl) {
          throw new Error(`A release v${targetRelease.version} não possui arquivo .deb anexado.`);
        }
        updateJob.step = `Baixando ${targetRelease.debAsset.name}...`;
        appendJobLog(`Baixando pacote Debian: ${debUrl}`);

        const tmpDeb = `/tmp/linux-resource_${targetRelease.version}_all.deb`;
        const cmd = `
          set -e
          wget -q -O ${shQuote(tmpDeb)} ${shQuote(debUrl)} || curl -fsSL -o ${shQuote(tmpDeb)} ${shQuote(debUrl)}
          dpkg --ignore-depends=nodejs -i ${shQuote(tmpDeb)} || apt-get install -f -y
          rm -f ${shQuote(tmpDeb)}
        `;

        updateJob.step = 'Instalando pacote .deb e reiniciando serviço...';
        appendJobLog('Executando dpkg -i no host...');
        const r = await execHostSudo(cmd, { timeout: 120000 });
        if (r.error === 'requires_sudo_password') {
          throw new Error('Configure a senha no Cofre Sudo para autorizar a instalação do pacote .deb.');
        }
        if (r.code !== 0) {
          throw new Error((r.stderr || r.stdout || r.error || 'Falha ao instalar pacote .deb').trim());
        }
        if (r.stdout.trim()) appendJobLog(r.stdout.trim());
      } else if (env.gitRepoDir) {
        const repoDir = env.gitRepoDir;
        updateJob.step = 'Sincronizando repositório Git (fetch & reset)...';
        appendJobLog(`Atualizando repositório em ${repoDir}...`);
        if (true) {
          const cmd = `
            set -e
            cd ${shQuote(repoDir)}
            git fetch origin --tags
            git reset --hard origin/main
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
