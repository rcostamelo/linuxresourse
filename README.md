<p align="center">
  <img src="public/Logo%20Linux%20Resource%20com%20Tux%20e%20Monitor.png" alt="Linux Resource" width="320">
</p>

<p align="center">
  <b>Português</b> · <a href="#english">English</a>
</p>

# Linux Resource — Português

Painel web para **gerenciar, monitorar e otimizar** desktops e servidores Linux: disco, processos,
memória, rede, Docker e **servidores remotos via SSH**, tudo em uma única interface, protegida por
login.

- **Backend**: Node.js puro (sem framework). Dados lidos de `/proc`, `/sys`, `du`, Docker e SSH.
- **Frontend**: React + Vite + shadcn/ui, tema escuro. Gráficos SVG feitos à mão.
- **Usuários e sessões**: SQLite nativo (`node:sqlite`), senhas com `scrypt`, cookie `HttpOnly`.
- **Servidores remotos**: coleta **sem agente** via SSH, agrupada em clusters, com logo por cluster e por servidor.
- **Docker**: imagem enxuta (~211 MB), com modo isolado ou modo host.

> Requer **Linux**. Em macOS e Windows o painel sobe, mas `/proc`, `du -x` e o Docker se comportam
> conforme o host ou a VM.

## Sumário

- [Requisitos](#requisitos)
- [Início rápido](#início-rápido)
- [Primeiro acesso](#primeiro-acesso)
- [Funcionalidades](#funcionalidades)
- [Configuração](#configuração)
- [Docker](#docker)
- [Segurança](#segurança)
- [API](#api)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Desenvolvimento](#desenvolvimento)
- [Licença](#licença)

## Requisitos

| Item | Necessário para |
|------|-----------------|
| **Node.js ≥ 22.5** | `node:sqlite` (exigido pelo `engines` do projeto) |
| Linux com `/proc` e `/sys` | processos, memória, rede e swap |
| `du` (GNU coreutils) | varredura de disco (`-B1` exige o `du` do GNU) |
| `ping` (iputils) | latência na aba Rede (opcional) |
| `ssh` (cliente OpenSSH) | aba SSH (modos Sistema e Chave) |
| `sshpass` | aba SSH, **somente** para autenticação por senha |
| Docker | aba Docker (opcional) |

## Início rápido

**Desenvolvimento** (API e Vite com HMR juntos):

```bash
npm install
npm run dev        # API em :10450, interface em http://127.0.0.1:5173
```

**Produção** (build estático servido pela própria API):

```bash
npm run build
npm start          # http://127.0.0.1:10450
```

## Primeiro acesso

Na primeira execução não existe usuário. O painel abre a tela de **configuração inicial** e pede
para criar o administrador. Não há credencial padrão.

A senha precisa ter **8 caracteres ou mais, com letras e números**. Depois disso, o acesso passa
pela tela de login. Ao trocar a senha, as **outras** sessões do usuário são encerradas.

## Funcionalidades

### Dashboard
- Medidores de CPU, memória e disco, e cartão de rede (download, upload e latência).
- Gráficos de carga do sistema (CPU e memória) e de tráfego de rede.
- Listas de interfaces, maiores consumidores de CPU e maiores consumidores de memória.

### Rede
- Latência, download, upload e total de conexões TCP.
- Tabela de interfaces (IP, velocidade, taxas, totais, erros e descartes).
- Estados TCP, portas em `LISTEN` e conexões ativas, com filtros e busca.

### Docker
- Containers com ações: iniciar, reiniciar, pausar, retomar, parar (com confirmação) e matar (SIGKILL).
- Logs por container (últimas 200, 500 ou 2000 linhas, ou modo seguir) e inspeção de detalhes.
- Imagens (incluindo as *dangling*), uso de disco (`docker system df`) e comandos de `prune` prontos para copiar.

### SSH (servidores remotos)
- Cadastre servidores e agrupe-os em **clusters**. Três modos de autenticação:
  - **Sistema**: usa o `~/.ssh/config` do host do painel, o ssh-agent e as chaves padrão. Não guarda credencial.
  - **Chave**: caminho de uma chave privada no host do painel (**recomendado**).
  - **Senha**: armazenada cifrada. Exige `sshpass` no host do painel.
- Coleta **sem agente**: conecta por SSH e lê `/proc`, `df` e `/proc/net/dev`. Nada é instalado no
  servidor alvo, e os comandos são somente leitura.
- Cada servidor aparece como um cartão com CPU, memória, disco (partição principal), rede,
  hostname, kernel, carga e uptime. O botão de teste verifica a conexão.
- **Logo (PNG, JPG, WEBP ou GIF, até 1,5 MB) por cluster e por servidor.** O cartão usa o logo do
  servidor e, na falta dele, o do cluster.

### Disco
- Mede cada pasta com `du -x -s -B1`: espaço **realmente alocado**, sem atravessar filesystems.
- Mapa de árvore (*treemap*) com navegação por níveis e resultados em **tempo real** (SSE). Cache de 5 minutos.

### Processos
- CPU **instantânea** por processo, amostrada de `/proc`.
- Tabela ordenável, com busca e encerramento de processo (SIGTERM ou outro sinal), com confirmação.

### Memória
- RAM e swap com barras, detalhamento (cache, buffers, memória compartilhada, sujos etc.) e
  maiores consumidores (RSS).

### Limpeza
- Tarefas em **lista fixa**: journal do systemd, cache do APT, miniaturas, lixeira, cache do npm,
  `docker system prune` e swapfiles órfãos.
- Mostra o espaço liberável, o comando exato (copiável) e o risco. Tudo exige confirmação.
- Tarefas com `sudo` só são executadas se o sudo não pedir senha. Caso contrário, copie o comando.

## Configuração

Copie `.env.example` para `.env`, ou exporte as variáveis. Todas são opcionais.

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `10450` | Porta do painel |
| `HOST` | `127.0.0.1` | Interface de escuta (use `0.0.0.0` para acesso pela rede) |
| `DATA_DIR` | `./data` | Diretório do SQLite, da chave mestra e dos logos |
| `SESSION_TTL_DAYS` | `7` | Validade da sessão (deslizante) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MIN` | `8` / `15` | Tentativas de login por IP antes do bloqueio |
| `TRUST_PROXY` | `0` | `1` para confiar em `X-Forwarded-For` e `X-Forwarded-Proto` (use só atrás de um proxy) |
| `MASTER_KEY` | — | Chave mestra em hexadecimal (64 caracteres). Se ausente, é gerada em `data/master.key` (0600) |
| `DU_CONCURRENCY` | `6` | Paralelismo da varredura de disco |
| `SCAN_ROOT` | — | Prefixo do filesystem a varrer (ex.: `/host` no modo host do Docker) |
| `DU_BIN` / `PING_BIN` / `DOCKER_BIN` | `du` / `ping` / `docker` | Caminhos dos binários |
| `SSH_BIN` / `SSHPASS_BIN` | `ssh` / `sshpass` | Cliente SSH e utilitário de senha |
| `SSH_CONFIG_FILE` | `~/.ssh/config` | Arquivo lido para listar apelidos (modo Sistema) |
| `SSH_CONNECT_TIMEOUT` / `SSH_COMMAND_TIMEOUT` | `8` / `20` | Timeouts em segundos |
| `SSH_CONCURRENCY` / `SSH_CACHE_SEC` | `6` / `4` | Coletas em paralelo e cache por servidor |

## Docker

A imagem empacota apenas a aplicação. O que o painel enxerga depende de como o container é executado.

### 1. Isolado (padrão)

```bash
docker compose up -d --build       # ou: npm run docker:up
# http://127.0.0.1:10450 (ou o IP da máquina, se a porta estiver publicada na rede)
```

O painel vê o disco, os processos e a rede **do próprio container**. Para a aba Docker funcionar sem
root, o compose monta `docker.sock` e adiciona o grupo do socket. Descubra o GID com:

```bash
export DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose up -d --build
```

### 2. Modo host (monitora a máquina de verdade)

```bash
docker compose -f docker-compose.host.yml up -d --build   # ou: npm run docker:host
```

Usa `pid: host`, `network_mode: host` e monta o filesystem do host em `/host:ro`, com
`SCAN_ROOT=/host`. **Exige Linux** e dá ao container acesso equivalente a root sobre o host.

> No modo host, a aba Limpeza aponta para caminhos do container, não do host. Execute essas
> tarefas diretamente no host. A varredura de disco e a aba Docker funcionam normalmente.

### SSH dentro do container

A imagem inclui `openssh-client` e `sshpass`. O `docker-compose.yml` monta o `~/.ssh` de quem sobe
o compose, como somente leitura. Use `SSH_DIR=/caminho` para apontar outro diretório.

- No modo **Sistema**, os apelidos do `config` aparecem na interface.
- No modo **Chave**, use o caminho interno, por exemplo `/home/node/.ssh/id_ed25519`.
- O container roda como uid **1000** (usuário `node`). Se o seu usuário tiver outro uid, ajuste
  `user:` no compose para que a chave `600` seja legível.
- Para chaves protegidas por senha, use o ssh-agent: descomente o volume do `SSH_AUTH_SOCK`.
- As credenciais cifradas e a `master.key` ficam no volume `/data`.

## Segurança

O painel dá acesso administrativo à máquina (processos, arquivos, Docker, SSH). Trate-o como um
serviço sensível.

**O que já é feito**

- Senhas com **scrypt** (N=16384, r=8, p=1) e salt aleatório por usuário, com comparação em tempo
  constante. O tempo de resposta do login não revela se o usuário existe.
- Sessões no SQLite, com token aleatório guardado apenas como hash SHA-256. Cookie `HttpOnly`,
  `SameSite=Lax` e `Secure` quando a conexão é HTTPS.
- **Rate limit** de login por IP.
- Endpoints de escrita exigem `Content-Type: application/json` e sessão válida.
- Ações destrutivas usam **listas fixas** no backend. Não existe execução de comando livre.
- Comandos externos são executados sem shell (`execFile`/`spawn` com argumentos em array).
- Credenciais SSH cifradas com **AES-256-GCM**. No modo Sistema nenhum segredo é gravado.

**O que você precisa configurar**

1. **HTTPS**: se o painel for acessível pela rede, coloque-o atrás de um proxy reverso com TLS
   (Caddy, Nginx, Traefik etc.) e defina `TRUST_PROXY=1`. Sem TLS, a senha trafega em texto puro.
2. **Porta**: por padrão o compose publica a porta em todas as interfaces. Para restringir à
   máquina local, troque para `127.0.0.1:10450:10450` no `docker-compose.yml`.
3. **`TRUST_PROXY`**: só ative atrás de um proxy que **sobrescreva** `X-Forwarded-For`. Sem proxy, o
   cabeçalho pode ser forjado e contornar o rate limit.
4. **`docker.sock`**: montar o socket equivale a dar root no host a quem controla o container.
   Remova a linha se não usar a aba Docker.
5. **Chave mestra**: faça backup de `data/master.key` (ou da variável `MASTER_KEY`). Sem ela, as
   credenciais SSH cadastradas não podem ser decifradas. Guarde o backup fora do mesmo volume do banco.
6. **Modo host**: o container tem acesso equivalente a root. Use apenas em máquinas que você administra.

## API

Todas as rotas `/api/*` exigem sessão, exceto `health` e as rotas de autenticação.

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Liveness (usado pelo HEALTHCHECK do Docker) |
| GET | `/api/auth/status` | `{ setup, authenticated, user }` |
| POST | `/api/auth/setup` | Cria o primeiro administrador (só quando não há usuários) |
| POST | `/api/auth/login` | `{ username, password }` cria a sessão |
| POST | `/api/auth/logout` | Encerra a sessão atual |
| GET | `/api/auth/me` | Usuário da sessão atual |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` |
| GET | `/api/scan?path=/` | Stream SSE com o tamanho de cada item do diretório |
| GET | `/api/fs?path=/` | Espaço total, usado e livre da partição |
| GET | `/api/system` | Host, uptime, carga, CPUs e uso de CPU |
| GET | `/api/processes` | Processos com CPU e carga |
| GET | `/api/memory` | `/proc/meminfo` normalizado |
| GET | `/api/metrics` | Sistema, memória e rede em um único snapshot |
| GET | `/api/history` | Série temporal recente |
| GET | `/api/network` | Taxas por interface, interfaces, estados TCP, portas e latência |
| GET | `/api/connections` | Conexões TCP ativas |
| GET | `/api/docker/overview` | Containers, imagens e `system df` |
| GET | `/api/docker/status` | Disponibilidade e versão do Docker |
| GET | `/api/docker/containers` | Containers com estatísticas de uso |
| GET | `/api/docker/images` | Imagens |
| GET | `/api/docker/df` | `docker system df` |
| GET | `/api/docker/logs?id=&tail=` | Logs de um container |
| GET | `/api/docker/inspect?id=` | Detalhes do container |
| POST | `/api/docker/action` | `{ id, action }`: start, stop, restart, pause, unpause ou kill |
| POST | `/api/kill` | `{ pid, signal }` envia um sinal |
| GET | `/api/clean/tasks` | Tarefas, espaço liberável e swapfiles órfãos |
| POST | `/api/clean/run` | `{ id, paths? }` executa uma tarefa da lista fixa |
| GET | `/api/ssh/overview` | Clusters, servidores e último snapshot |
| GET | `/api/ssh/config` | Apelidos do `~/.ssh/config` (modo Sistema) |
| GET | `/api/ssh/logo/<arquivo>` | Logo de cluster ou servidor (autenticado) |
| POST | `/api/ssh/clusters` | `{ name, logo? }` cria um cluster |
| POST | `/api/ssh/clusters/update` | `{ id, name?, logo? }` |
| POST | `/api/ssh/clusters/delete` | `{ id }` (os servidores voltam para "Sem cluster") |
| POST | `/api/ssh/servers` | Cadastra um servidor (`authType`: `key`, `password` ou `system`) |
| POST | `/api/ssh/servers/update` | Atualiza um servidor. Credencial e logo vazios mantêm os atuais |
| POST | `/api/ssh/servers/delete` | `{ id }` |
| POST | `/api/ssh/servers/test` | `{ id }` testa a conexão e devolve hostname e kernel |

## Estrutura do projeto

```
server/
  index.js      # servidor HTTP, rotas e controle de autenticação
  config.js     # variáveis de ambiente e caminhos
  db.js         # SQLite: usuários, sessões, clusters e servidores SSH
  auth.js       # scrypt, sessões, cookies e rate limit
  secrets.js    # chave mestra local e AES-256-GCM
  disk.js       # varredura com du, SSE e cache
  system.js     # amostragem de /proc: CPU, memória, rede e histórico
  network.js    # /proc/net/dev, interfaces, TCP e latência
  docker.js     # CLI do Docker: containers, estatísticas, logs e ações
  ssh.js        # coleta sem agente (sistema, chave ou senha) e cache
  logos.js      # upload, remoção e leitura dos logos em data/logos/
  clean.js      # tarefas de limpeza em lista fixa
src/
  App.tsx       # tela de login, layout e abas
  components/   # Dashboard, Rede, Docker, SSH, Disco, Processos, Memória, Limpeza
  lib/          # api, format, usePoll, utils
public/         # logos e favicon
data/           # banco, chave mestra e logos (criados no primeiro uso; fora do git)
```

## Desenvolvimento

```bash
npm run build      # checagem de tipos (tsc) e build do frontend
npm run server     # só a API
npm run preview    # serve o build do frontend
```

O projeto ainda não tem suíte de testes automatizados nem lint configurado.

## Licença

MIT. Veja [LICENSE](LICENSE).

---

<a id="english"></a>

# Linux Resource — English

Web panel to **manage, monitor and optimize** Linux desktops and servers: disk, processes, memory,
network, Docker and **remote servers over SSH**, all in one interface protected by login.

- **Backend**: plain Node.js (no framework). Data is read from `/proc`, `/sys`, `du`, Docker and SSH.
- **Frontend**: React + Vite + shadcn/ui, dark theme. Hand-made SVG charts.
- **Users and sessions**: native SQLite (`node:sqlite`), `scrypt` password hashing, `HttpOnly` cookies.
- **Remote servers**: **agentless** collection over SSH, grouped into clusters, with a logo per cluster and per server.
- **Docker**: slim image (~211 MB), with an isolated mode or a host mode.

> Requires **Linux**. On macOS and Windows the panel runs, but `/proc`, `du -x` and Docker behave
> according to the host or VM.

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [First run](#first-run)
- [Features](#features)
- [Configuration](#configuration-1)
- [Docker](#docker-1)
- [Security](#security)
- [API](#api-1)
- [Project structure](#project-structure)
- [Development](#development)
- [License](#license-1)

## Requirements

| Item | Needed for |
|------|-----------|
| **Node.js ≥ 22.5** | `node:sqlite` (required by the project's `engines` field) |
| Linux with `/proc` and `/sys` | processes, memory, network and swap |
| `du` (GNU coreutils) | disk scan (`-B1` requires GNU `du`) |
| `ping` (iputils) | latency on the Network tab (optional) |
| `ssh` (OpenSSH client) | SSH tab (System and Key modes) |
| `sshpass` | SSH tab, **only** for password authentication |
| Docker | Docker tab (optional) |

## Quick start

**Development** (API and Vite with HMR together):

```bash
npm install
npm run dev        # API on :10450, UI at http://127.0.0.1:5173
```

**Production** (static build served by the API itself):

```bash
npm run build
npm start          # http://127.0.0.1:10450
```

## First run

On first start there are no users. The panel opens the **initial setup** screen and asks you to
create the administrator. There are no default credentials.

Passwords need **at least 8 characters, with letters and numbers**. After that, access goes through
the login screen. Changing your password ends your **other** sessions.

## Features

### Dashboard
- Gauges for CPU, memory and disk, and a network card (download, upload and latency).
- System load charts (CPU and memory) and network traffic charts.
- Lists of interfaces, top CPU consumers and top memory consumers.

### Network
- Latency, download, upload and total TCP connections.
- Interface table (IP, speed, rates, totals, errors and drops).
- TCP states, `LISTEN` ports and active connections, with filters and search.

### Docker
- Containers with actions: start, restart, pause, unpause, stop (with confirmation) and kill (SIGKILL).
- Logs per container (last 200, 500 or 2000 lines, or follow mode) and detailed inspection.
- Images (including dangling ones), disk usage (`docker system df`) and copy-ready `prune` commands.

### SSH (remote servers)
- Add servers and group them into **clusters**. Three authentication modes:
  - **System**: uses the panel host's `~/.ssh/config`, ssh-agent and default keys. Stores no credential.
  - **Key**: path to a private key on the panel host (**recommended**).
  - **Password**: stored encrypted. Requires `sshpass` on the panel host.
- **Agentless** collection: connects over SSH and reads `/proc`, `df` and `/proc/net/dev`. Nothing is
  installed on the target, and the commands are read-only.
- Each server appears as a card with CPU, memory, disk (main partition), network, hostname, kernel,
  load and uptime. The test button checks the connection.
- **Logo (PNG, JPG, WEBP or GIF, up to 1.5 MB) per cluster and per server.** The card uses the server
  logo and falls back to the cluster logo.

### Disk
- Measures each folder with `du -x -s -B1`: **actually allocated** space, without crossing filesystems.
- Squarified treemap with drill-down and **real-time** results (SSE). 5-minute cache.

### Processes
- **Instantaneous** CPU per process, sampled from `/proc`.
- Sortable table with search and process termination (SIGTERM or another signal), with confirmation.

### Memory
- RAM and swap bars, a breakdown (cache, buffers, shared, dirty and more) and top consumers (RSS).

### Cleanup
- **Fixed-list** tasks: systemd journal, APT cache, thumbnails, trash, npm cache,
  `docker system prune` and orphaned swapfiles.
- Shows reclaimable space, the exact command (copyable) and the risk. Everything requires confirmation.
- Tasks that need `sudo` only run if sudo does not ask for a password. Otherwise, copy the command.

## Configuration

Copy `.env.example` to `.env`, or export the variables. All are optional.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `10450` | Panel port |
| `HOST` | `127.0.0.1` | Listen interface (use `0.0.0.0` for network access) |
| `DATA_DIR` | `./data` | SQLite database, master key and logos |
| `SESSION_TTL_DAYS` | `7` | Session lifetime (sliding) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MIN` | `8` / `15` | Login attempts per IP before blocking |
| `TRUST_PROXY` | `0` | `1` to trust `X-Forwarded-For` and `X-Forwarded-Proto` (only behind a proxy) |
| `MASTER_KEY` | — | Master key as hex (64 characters). If unset, generated in `data/master.key` (0600) |
| `DU_CONCURRENCY` | `6` | Disk scan parallelism |
| `SCAN_ROOT` | — | Filesystem prefix to scan (e.g. `/host` in Docker host mode) |
| `DU_BIN` / `PING_BIN` / `DOCKER_BIN` | `du` / `ping` / `docker` | Binary paths |
| `SSH_BIN` / `SSHPASS_BIN` | `ssh` / `sshpass` | SSH client and password helper |
| `SSH_CONFIG_FILE` | `~/.ssh/config` | File read to list host aliases (System mode) |
| `SSH_CONNECT_TIMEOUT` / `SSH_COMMAND_TIMEOUT` | `8` / `20` | Timeouts in seconds |
| `SSH_CONCURRENCY` / `SSH_CACHE_SEC` | `6` / `4` | Parallel collections and per-server cache |

## Docker

The image only packages the application. What the panel can see depends on how the container runs.

### 1. Isolated (default)

```bash
docker compose up -d --build       # or: npm run docker:up
# http://127.0.0.1:10450 (or the machine's IP, if the port is published on the network)
```

The panel sees the disk, processes and network **of the container itself**. To let the Docker tab
work without root, the compose file mounts `docker.sock` and adds the socket's group. Find the GID with:

```bash
export DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose up -d --build
```

### 2. Host mode (monitors the real machine)

```bash
docker compose -f docker-compose.host.yml up -d --build   # or: npm run docker:host
```

Uses `pid: host`, `network_mode: host` and mounts the host filesystem at `/host:ro`, with
`SCAN_ROOT=/host`. **Requires Linux** and gives the container root-equivalent access to the host.

> In host mode, the Cleanup tab points to container paths, not host paths. Run those tasks directly
> on the host. Disk scanning and the Docker tab work normally.

### SSH inside the container

The image includes `openssh-client` and `sshpass`. The compose file mounts the `~/.ssh` of whoever
starts it, read-only. Use `SSH_DIR=/path` to point to another directory.

- In **System** mode, the `config` aliases appear in the interface.
- In **Key** mode, use the in-container path, for example `/home/node/.ssh/id_ed25519`.
- The container runs as uid **1000** (`node` user). If your user has a different uid, change `user:`
  in the compose file so the `600` key is readable.
- For keys protected by a passphrase, use ssh-agent: uncomment the `SSH_AUTH_SOCK` volume.
- Encrypted credentials and `master.key` live in the `/data` volume.

## Security

The panel grants administrative access to the machine (processes, files, Docker, SSH). Treat it as a
sensitive service.

**Built in**

- Passwords hashed with **scrypt** (N=16384, r=8, p=1) and a random salt per user, compared in
  constant time. Login response time does not reveal whether a user exists.
- Sessions stored in SQLite, with the random token kept only as a SHA-256 hash. `HttpOnly` cookie,
  `SameSite=Lax`, and `Secure` when the connection is HTTPS.
- **Rate limiting** on login, per IP.
- Write endpoints require `Content-Type: application/json` and a valid session.
- Destructive actions use **fixed lists** on the backend. There is no free-form command execution.
- External commands run without a shell (`execFile`/`spawn` with argument arrays).
- SSH credentials encrypted with **AES-256-GCM**. In System mode, no secret is stored.

**What you need to configure**

1. **HTTPS**: if the panel is reachable over the network, put it behind a reverse proxy with TLS
   (Caddy, Nginx, Traefik, etc.) and set `TRUST_PROXY=1`. Without TLS, passwords travel in plain text.
2. **Port**: by default the compose file publishes the port on all interfaces. To restrict it to the
   local machine, change it to `127.0.0.1:10450:10450` in `docker-compose.yml`.
3. **`TRUST_PROXY`**: enable it only behind a proxy that **overwrites** `X-Forwarded-For`. Without a
   proxy, the header can be forged to bypass rate limiting.
4. **`docker.sock`**: mounting the socket is equivalent to giving root on the host to anyone who controls
   the container. Remove the line if you do not use the Docker tab.
5. **Master key**: back up `data/master.key` (or the `MASTER_KEY` value). Without it, the stored SSH
   credentials cannot be decrypted. Keep the backup outside the database volume.
6. **Host mode**: the container has root-equivalent access. Use it only on machines you administer.

## API

All `/api/*` routes require a session, except `health` and the authentication routes.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | Liveness (used by the Docker HEALTHCHECK) |
| GET | `/api/auth/status` | `{ setup, authenticated, user }` |
| POST | `/api/auth/setup` | Creates the first administrator (only when there are no users) |
| POST | `/api/auth/login` | `{ username, password }` creates a session |
| POST | `/api/auth/logout` | Ends the current session |
| GET | `/api/auth/me` | Current session user |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` |
| GET | `/api/scan?path=/` | SSE stream with the size of each directory entry |
| GET | `/api/fs?path=/` | Total, used and free space of the partition |
| GET | `/api/system` | Host, uptime, load, CPUs and CPU usage |
| GET | `/api/processes` | Processes with CPU and load |
| GET | `/api/memory` | Normalized `/proc/meminfo` |
| GET | `/api/metrics` | System, memory and network in one snapshot |
| GET | `/api/history` | Recent time series |
| GET | `/api/network` | Per-interface rates, interfaces, TCP states, ports and latency |
| GET | `/api/connections` | Active TCP connections |
| GET | `/api/docker/overview` | Containers, images and `system df` |
| GET | `/api/docker/status` | Docker availability and version |
| GET | `/api/docker/containers` | Containers with usage statistics |
| GET | `/api/docker/images` | Images |
| GET | `/api/docker/df` | `docker system df` |
| GET | `/api/docker/logs?id=&tail=` | Container logs |
| GET | `/api/docker/inspect?id=` | Container details |
| POST | `/api/docker/action` | `{ id, action }`: start, stop, restart, pause, unpause or kill |
| POST | `/api/kill` | `{ pid, signal }` sends a signal |
| GET | `/api/clean/tasks` | Tasks, reclaimable space and orphaned swapfiles |
| POST | `/api/clean/run` | `{ id, paths? }` runs a task from the fixed list |
| GET | `/api/ssh/overview` | Clusters, servers and latest snapshot |
| GET | `/api/ssh/config` | Aliases from `~/.ssh/config` (System mode) |
| GET | `/api/ssh/logo/<file>` | Cluster or server logo (authenticated) |
| POST | `/api/ssh/clusters` | `{ name, logo? }` creates a cluster |
| POST | `/api/ssh/clusters/update` | `{ id, name?, logo? }` |
| POST | `/api/ssh/clusters/delete` | `{ id }` (servers move to "No cluster") |
| POST | `/api/ssh/servers` | Adds a server (`authType`: `key`, `password` or `system`) |
| POST | `/api/ssh/servers/update` | Updates a server. Empty credential or logo keeps the current one |
| POST | `/api/ssh/servers/delete` | `{ id }` |
| POST | `/api/ssh/servers/test` | `{ id }` tests the connection and returns hostname and kernel |

## Project structure

```
server/
  index.js      # HTTP server, routes and authentication gate
  config.js     # environment variables and paths
  db.js         # SQLite: users, sessions, clusters and SSH servers
  auth.js       # scrypt, sessions, cookies and rate limiting
  secrets.js    # local master key and AES-256-GCM
  disk.js       # du scan, SSE and cache
  system.js     # /proc sampling: CPU, memory, network and history
  network.js    # /proc/net/dev, interfaces, TCP and latency
  docker.js     # Docker CLI: containers, stats, logs and actions
  ssh.js        # agentless collection (system, key or password) and cache
  logos.js      # upload, removal and reading of logos in data/logos/
  clean.js      # cleanup tasks from a fixed list
src/
  App.tsx       # login screen, layout and tabs
  components/   # Dashboard, Network, Docker, SSH, Disk, Processes, Memory, Cleanup
  lib/          # api, format, usePoll, utils
public/         # logos and favicon
data/           # database, master key and logos (created on first use; not in git)
```

## Development

```bash
npm run build      # type check (tsc) and frontend build
npm run server     # API only
npm run preview    # serve the frontend build
```

The project does not yet have automated tests or a configured linter.

## License

MIT. See [LICENSE](LICENSE).
