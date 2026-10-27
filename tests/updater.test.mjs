import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dockerUpdateCommand, nativeDebUpdateCommand } from '../server/updater.js';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'linux-resource-update-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = path.join(root, 'origin.git');
  const upstream = path.join(root, 'upstream');
  const checkout = path.join(root, 'project with spaces');
  mkdirSync(upstream);
  git(root, 'init', '--bare', '--initial-branch=main', origin);
  git(upstream, 'init', '--initial-branch=main');
  git(upstream, 'config', 'user.email', 'test@example.invalid');
  git(upstream, 'config', 'user.name', 'Update Test');
  writeFileSync(path.join(upstream, 'tracked.txt'), 'original\n');
  git(upstream, 'add', 'tracked.txt');
  git(upstream, 'commit', '-m', 'initial');
  git(upstream, 'remote', 'add', 'origin', origin);
  git(upstream, 'push', '-u', 'origin', 'main');
  git(root, 'clone', '--branch', 'main', origin, checkout);
  writeFileSync(path.join(upstream, 'tracked.txt'), 'release\n');
  git(upstream, 'add', 'tracked.txt');
  git(upstream, 'commit', '-m', 'release');
  git(upstream, 'tag', 'v1.0.11');
  git(upstream, 'push', 'origin', 'main', '--tags');

  const bin = path.join(root, 'bin');
  const log = path.join(root, 'calls.log');
  const pkg = path.join(root, 'fixture.deb');
  const sums = path.join(root, 'fixture.sha256');
  mkdirSync(bin);
  writeFileSync(pkg, 'isolated package fixture\n');
  const hash = createHash('sha256').update(readFileSync(pkg)).digest('hex');
  writeFileSync(sums, `${hash}  linux-resource_1.0.11_all.deb\n`);
  const script = (name, text) => writeFileSync(path.join(bin, name), `#!/bin/sh\n${text}\n`, { mode: 0o755 });
  script('runuser', 'shift 3\nif [ "$1" = env ]; then exit 0; fi\nexec "$@"');
  script('docker', 'printf "docker %s\\n" "$*" >> "$TEST_LOG"');
  script('apt-get', 'printf "apt-get %s\\n" "$*" >> "$TEST_LOG"');
  script('dpkg-query', 'printf "1.0.11"');
  script('curl', 'case "$2" in */SHA256SUMS) cp "$TEST_SUMS" "$4" ;; *) cp "$TEST_PACKAGE" "$4" ;; esac');
  script('gnome-shell', 'exit 0');
  script('python3', 'exit 1');

  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TEST_LOG: log,
    TEST_PACKAGE: pkg,
    TEST_SUMS: sums,
  };
  const release = {
    tagName: 'v1.0.11', version: '1.0.11',
    debAsset: { name: 'linux-resource_1.0.11_all.deb', downloadUrl: 'https://example.invalid/package.deb' },
    checksumUrl: 'https://example.invalid/SHA256SUMS',
  };
  const installation = {
    gitRepoDir: checkout,
    composeProject: 'linuxresourse',
    composeFiles: [path.join(checkout, 'docker-compose.host.yml')],
  };
  return { root, checkout, log, sums, environment, release, installation };
}

function runUpdate(f) {
  return spawnSync('bash', ['-c', dockerUpdateCommand(f.installation, f.release, true)], {
    cwd: f.checkout, env: f.environment, encoding: 'utf8', timeout: 30000,
  });
}

test('atualiza por fast-forward, confere o pacote e usa o projeto Compose existente', (t) => {
  const f = fixture(t);
  const result = runUpdate(f);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(readFileSync(path.join(f.checkout, 'tracked.txt'), 'utf8'), 'release\n');
  const calls = readFileSync(f.log, 'utf8');
  assert.match(calls, /apt-get install -y --no-install-recommends/);
  assert.doesNotMatch(calls, /python3-pyqt6|gnome-shell-extension-appindicator/);
  assert.match(calls, /docker compose .*--project-name linuxresourse .*docker-compose\.host\.yml up -d --build/);
});

test('preserva alterações locais e não instala nem reconstrói o container', (t) => {
  const f = fixture(t);
  const before = git(f.checkout, 'rev-parse', 'HEAD');
  writeFileSync(path.join(f.checkout, 'tracked.txt'), 'minha alteração\n');
  const result = runUpdate(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /alterações locais/);
  assert.equal(readFileSync(path.join(f.checkout, 'tracked.txt'), 'utf8'), 'minha alteração\n');
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), before);
  assert.throws(() => readFileSync(f.log));
});

test('não instala o pacote nem reconstrói o container se o checksum falhar', (t) => {
  const f = fixture(t);
  writeFileSync(f.sums, `${'0'.repeat(64)}  linux-resource_1.0.11_all.deb\n`);
  const result = runUpdate(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /FAILED|falhou/i);
  assert.throws(() => readFileSync(f.log));
});

test('não tenta usar um Compose que não foi identificado', () => {
  assert.throws(() => dockerUpdateCommand({ gitRepoDir: '/tmp/repo', composeFiles: [], composeProject: null }, { tagName: 'v1.0.11' }, false), /identificar/);
});

test('atualização Debian nativa usa serviço transitório para não interromper o dpkg', (t) => {
  const f = fixture(t);
  const systemdRun = path.join(f.root, 'bin/systemd-run');
  writeFileSync(systemdRun, '#!/bin/sh\nprintf "systemd-run %s\\n" "$*" >> "$TEST_LOG"\n', { mode: 0o755 });
  const command = nativeDebUpdateCommand(f.release, 'linux-resource-update-test');
  const result = spawnSync('bash', ['-c', command], { env: f.environment, encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(f.log, 'utf8'), /systemd-run --quiet --wait --collect --unit=linux-resource-update-test/);
});

test('encontra o repositório em /mnt pelo Compose e identifica a versão do desktop', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'linux-resource-detect-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const host = path.join(root, 'host');
  const bin = path.join(root, 'bin');
  const project = path.join(host, 'mnt/storage/linuxresourse');
  mkdirSync(app); mkdirSync(bin); mkdirSync(path.join(project, '.git'), { recursive: true });
  mkdirSync(path.join(host, 'opt/linux-resource'), { recursive: true });
  cpSync(path.resolve('server'), path.join(app, 'server'), { recursive: true });
  writeFileSync(path.join(app, 'package.json'), '{"type":"module","name":"linux-resource","version":"1.0.9"}');
  writeFileSync(path.join(project, 'package.json'), '{"name":"linux-resource","version":"1.0.11"}');
  writeFileSync(path.join(host, 'opt/linux-resource/package.json'), '{"name":"linux-resource","version":"1.0.10"}');
  writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nif [ "$1" = ps ]; then echo linux-resource; exit 0; fi\nif [ "$1" = inspect ] && [ "$4" = linux-resource ]; then printf "true|/mnt/storage/linuxresourse|/mnt/storage/linuxresourse/docker-compose.yml|linuxresourse\\n"; exit 0; fi\nexit 1\n', { mode: 0o755 });
  const code = `import {detectInstallEnvironment} from ${JSON.stringify(`file://${path.join(app, 'server/updater.js')}`)}; console.log(JSON.stringify(await detectInstallEnvironment()));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, SCAN_ROOT: host, DATA_DIR: path.join(root, 'data'), PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8', timeout: 30000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim(), `Sem resposta do processo: ${result.stderr}`);
  const detected = JSON.parse(result.stdout);
  assert.equal(detected.installMode, 'docker-git');
  assert.equal(detected.gitRepoDir, '/mnt/storage/linuxresourse');
  assert.equal(detected.desktopVersion, '1.0.10');
  assert.equal(detected.composeProject, 'linuxresourse');
  assert.deepEqual(detected.composeFiles, ['/mnt/storage/linuxresourse/docker-compose.yml']);
});
