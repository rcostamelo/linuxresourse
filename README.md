# Linux Resource

Painel web para **gerenciar, monitorar e otimizar** desktops e servidores Linux: disco,
processos, memória, rede, Docker e **servidores remotos via SSH** — tudo em uma única UI, com
**login** e sem dependências nativas.

- **Backend**: Node puro (sem framework), dados lidos de `/proc`, `/sys`, `du`, Docker e SSH.
- **Frontend**: React + Vite + shadcn/ui (tema escuro), gráficos em SVG feitos à mão.
- **Usuários e sessões**: SQLite nativo (`node:sqlite`), senhas com `scrypt`, cookie `HttpOnly`.
- **Servidores remotos**: coleta **agente-less** por SSH (modo Sistema via `~/.ssh/config`, chave ou senha), agrupada em clusters, com **logo (PNG) por cluster/servidor**.
- **Docker**: imagem enxuta (~211 MB) e, opcionalmente, modo host (`pid: host` + `/:/host:ro`).

> Roda em **Linux**. Em macOS/Windows o disco e os processos aparecem, mas `/proc`, `du -x`
> e Docker seguem o comportamento do host/VM.

## Requisitos

| Item | Necessário para |
|------|-----------------|
| **Node.js ≥ 22.5** | `node:sqlite` (o `engines` do projeto exige isso) |
| Linux com `/proc` e `/sys` | processos, memória, rede, swap |
| `du` (GNU coreutils) | scan de disco — `-B1` precisa ser o GNU `du` |
| `ping` (iputils) | latência na aba Rede (opcional) |
| `ssh` (OpenSSH client) | aba SSH — coleta em servidores remotos (modos Sistema e Chave) |
| `sshpass` | aba SSH — **apenas** para autenticação por senha (Sistema/Chave não precisam) |
| Docker | aba Docker (opcional) |

## Rodar

**Desenvolvimento** (API + Vite com HMR juntos):

```bash
npm install
npm run dev            # API em :10450, UI em http://127.0.0.1:5173
```

**Produção** (build estático servido pela própria API):

```bash
npm run build
npm start              # http://127.0.0.1:10450
```

## Primeiro acesso

Na primeira execução **não existe usuário algum** — o painel abre a tela de
**configuração inicial** e pede para criar o administrador (usuário + senha).
Não há credencial padrão, o que evita o clássico `admin/admin` em repositório público.

A senha exige **≥ 8 caracteres, com letras e números**. Depois de criado, o acesso passa pela
tela de login. Trocar a senha encerra as **outras** sessões do usuário.

## Autenticação e segurança

- Senhas com **`scrypt` (N=16384, r=8, p=1) + salt aleatório** por usuário, comparação em tempo constante.
- Sessões guardadas no SQLite (`sessions`), com **expiração deslizante** (`SESSION_TTL_DAYS`) e
  cookie **`HttpOnly`, `SameSite=Lax`** (e `Secure` automaticamente sob HTTPS).
- **Rate limit** de login por IP (`LOGIN_MAX_ATTEMPTS` em `LOGIN_WINDOW_MIN`).
- Endpoints de escrita exigem **`Content-Type: application/json`** e o cookie de sessão.
- Bind padrão em `127.0.0.1`; para expor na rede use `HOST=0.0.0.0` — coloque atrás de um proxy
  com HTTPS e defina `TRUST_PROXY=1`.
- Ações destrutivas (`/api/kill`, `/api/clean/run`, `/api/docker/action`) têm confirmação na UI e
  **whitelists** no backend (nunca comando livre).
- Credenciais SSH (chave/senha) ficam **cifradas** no SQLite (AES-256-GCM) com a chave mestra em
  `data/master.key` (**0600**, fora do git). Sem essa chave, o banco não revela as credenciais —
  guarde-a para não perder o acesso aos servidores cadastrados. O modo **Sistema** não guarda
  segredo: usa o `~/.ssh/config`, o ssh-agent e as chaves do usuário do painel.

## Configuração

Copie `.env.example` para `.env` (ou exporte as variáveis). Todas são opcionais.

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `10450` | Porta do painel (fora das faixas comuns e da faixa efêmera) |
| `HOST` | `127.0.0.1` | Interface de escuta |
| `DATA_DIR` | `./data` | Diretório do SQLite (`linux-resource.db`) |
| `SESSION_TTL_DAYS` | `7` | Validade da sessão |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MIN` | `8` / `15` | Tentativas de login antes do bloqueio |
| `DU_CONCURRENCY` | `6` | Paralelismo do scan de disco |
| `SCAN_ROOT` | — | Prefixo do filesystem a varrer (ex.: `/host` em modo host) |
| `DU_BIN` / `PING_BIN` / `DOCKER_BIN` | `du` / `ping` / `docker` | Caminhos dos binários |
| `SSH_BIN` / `SSHPASS_BIN` | `ssh` / `sshpass` | Cliente SSH (senha exige `sshpass`) |
| `SSH_CONNECT_TIMEOUT` / `SSH_COMMAND_TIMEOUT` | `8` / `20` | Timeouts de conexão e do comando remoto (segundos) |
| `SSH_CONCURRENCY` / `SSH_CACHE_SEC` | `6` / `4` | Coleta paralela e cache do snapshot por servidor |
| `SSH_CONFIG_FILE` | `~/.ssh/config` | Arquivo lido para listar apelidos (modo Sistema) |
| `MASTER_KEY` | — | Chave mestra (hex de 64) para cifrar credenciais; gerada em `data/master.key` (0600) |
| `TRUST_PROXY` | `0` | Confia em `X-Forwarded-For`/`-Proto` (HTTPS + IP real) |

## Docker

Duas formas. A **imagem** só empacota a aplicação (o que ela "enxerga" depende dos namespaces).

### 1. Padrão — isolado

```bash
docker compose up -d --build      # ou: npm run docker:up
# http://127.0.0.1:10450
```

Vê o disco, os processos e a rede **do próprio container**. O `docker.sock` é montado para a aba
Docker funcionar sem rodar como root, usando o GID do socket:

```bash
export DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
docker compose up -d --build
```

### 2. Modo host — monitora a máquina de verdade

```bash
docker compose -f docker-compose.host.yml up -d --build   # ou: npm run docker:host
```

Usa `pid: host` (processos do host), `network_mode: host` e monta o filesystem em `/host:ro`
com `SCAN_ROOT=/host`. Rodar como host **requer Linux** e dá ao container acesso equivalente a
root; use sabendo disso.

> No modo host, a aba **Limpeza** (journal/apt/etc.) aponta para caminhos do container, não do
> host — rode esses comandos direto no host. O scan de disco e a aba Docker funcionam normalmente.

> **SSH no container**: a imagem inclui `openssh-client` e `sshpass`. O `docker-compose.yml` já monta
> o `~/.ssh` do usuário que sobe o compose (`"${SSH_DIR:-${HOME}/.ssh}:/home/node/.ssh:ro"`) — funciona
> em qualquer máquina sem editar; use `SSH_DIR=/caminho` para apontar outro diretório. O modo **Sistema**
> passa a listar os apelidos do `config`; no modo **Chave** use o caminho interno (ex.:
> `/home/node/.ssh/id_ed25519`). Detalhes: o container roda como uid **1000** (`node`) — se o seu usuário
> tiver outro uid, ajuste `user:` no compose para ler a chave `600`; e, para chaves com senha
> (ssh-agent), descomente o volume do `SSH_AUTH_SOCK`. As credenciais cifradas e o `master.key` ficam
> no volume `/data`.

## Abas

### Dashboard
- **Gauges** de CPU, memória e disco + cartão de **rede** (download/upload e latência).
- Gráficos SVG de **Carga do sistema** (CPU/Memória) e **Tráfego de rede** (rx/tx) lado a lado.
- **Interfaces**, **Top CPU** e **Top memória** em três colunas.

### Rede
- Latência, download, upload e total de conexões TCP.
- Gráfico de tráfego e **tabela de interfaces** (IP, velocidade, taxas, totais, erros/drops; ver virtuais).
- **Estados TCP**, **portas em LISTEN** e **conexões ativas** (filtros por estado + busca).

### Docker
- Containers (projeto/serviço, imagem, portas, estado) com **ações**: iniciar, reiniciar, pausar,
  retomar, parar (confirmado) e matar (SIGKILL).
- **Logs** por container (tail 200/500/2000, modo seguir) e **inspeção** de detalhes.
- **Imagens** (marca *dangling*), **uso de disco** (`docker system df`) e comandos de `prune` copiáveis.

### SSH
- Adicione **servidores remotos** e agrupe em **clusters**. Três modos de autenticação:
  - **Sistema** — usa o `~/.ssh/config` do host do painel, o **ssh-agent** e as chaves padrão.
    Nenhuma credencial é guardada; basta escolher o apelido do config (ou digitar host/porta).
  - **Chave** — caminho de uma chave privada no host do painel (recomendado).
  - **Senha** — armazenada cifrada (exige `sshpass` no host do painel).
- Coleta **agente-less**: conecta por SSH e lê `/proc`, `df` e `/proc/net/dev` — **nada é instalado**
  no alvo, e os comandos são somente leitura.
- Cada servidor vira um **card** com **CPU**, **memória**, **disco** (partição principal) e **rede**
  (download/upload), além de hostname, kernel, carga e uptime. *Testar* a conexão pelo botão de raio.
- **Logo (PNG) por cluster e por servidor**: envie a imagem no diálogo (PNG/JPG/WEBP/GIF, até 1,5 MB).
  O card usa o logo do servidor e, se não houver, o do cluster; sem logo, cai no ícone padrão. Os
  arquivos ficam em `data/logos/` e são servidos por rota autenticada (`/api/ssh/logo/…`), sem inflar
  as respostas do polling.
- Nos modos **Chave** e **Senha**, as credenciais ficam **cifradas** no SQLite (AES-256-GCM) com a chave mestra local. A senha SSH exige
  `sshpass` no host do painel; **chave privada (ou o modo Sistema) é o método recomendado**. O modo
  **Sistema** reaproveita o `~/.ssh/config`/agent e **não grava segredo nenhum** no banco.

### Disco
- Mede cada pasta com `du -x -s -B1` (espaço **real alocado**, sem cruzar filesystems).
- **Treemap** squarified com drill-down, resultados em **tempo real (SSE)** e cache de 5 min.

### Processos
- CPU **instantânea** por processo amostrada de `/proc` (não a média do `ps`).
- Tabela ordenável com busca e **encerrar processo** (SIGTERM) com confirmação.

### Memória
- RAM/Swap com barras, breakdown (cache, buffers, compartilhada, dirty…) e maiores consumidores (RSS).

### Limpeza
- Tarefas em **whitelist**: journal do systemd, cache do APT, miniaturas, lixeira, cache do npm,
  `docker system prune` e **swapfiles órfãos**.
- Mostra tamanho liberável, comando exato (copiável) e risco, sempre com confirmação.
- Tarefas com `sudo` só executam se houver sudo sem senha; senão use **copiar comando**.
- Detecção de swap órfão ignora o que está em `/proc/swaps` ou no `/etc/fstab`.

## API

Todas as rotas `/api/*` exigem sessão válida, **exceto** `health` e as de autenticação.

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Liveness (usado pelo HEALTHCHECK do Docker) |
| GET | `/api/auth/status` | `{ setup, authenticated, user }` |
| POST | `/api/auth/setup` | Cria o primeiro administrador (só quando não há usuários) |
| POST | `/api/auth/login` | `{ username, password }` → cria a sessão |
| POST | `/api/auth/logout` | Encerra a sessão atual |
| GET | `/api/auth/me` | Usuário da sessão atual |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` |
| GET | `/api/scan?path=/` | Stream SSE com o tamanho de cada item do diretório |
| GET | `/api/fs?path=/` | Espaço total/usado/livre da partição |
| GET | `/api/system` | Host, uptime, load, CPUs, uso de CPU |
| GET | `/api/processes` | Snapshot de processos + CPU + load |
| GET | `/api/memory` | `/proc/meminfo` normalizado |
| GET | `/api/metrics` | Snapshot combinado: sistema + memória + rede |
| GET | `/api/history` | Série temporal (últimos ~180 pontos) |
| GET | `/api/network` | Taxas por interface, interfaces, estados TCP, portas e latência |
| GET | `/api/connections` | Conexões TCP ativas (`/proc/net/tcp{,6}`) |
| GET | `/api/docker/overview` | Containers + stats + imagens + `system df` |
| GET | `/api/docker/status` | Disponibilidade e versão do Docker |
| GET | `/api/docker/containers` | Containers com estatísticas de uso |
| GET | `/api/docker/images` | Imagens (inclui *dangling*) |
| GET | `/api/docker/df` | `docker system df` |
| GET | `/api/docker/logs?id=&tail=` | Logs de um container |
| GET | `/api/docker/inspect?id=` | Detalhes (health, mounts, redes, env) |
| POST | `/api/docker/action` | `{ id, action }` → start/stop/restart/pause/unpause/kill |
| POST | `/api/kill` | `{ pid, signal }` → envia sinal (TERM/KILL/STOP/CONT/…) |
| GET | `/api/clean/tasks` | Tarefas + tamanho liberável + swapfiles órfãos |
| POST | `/api/clean/run` | `{ id, paths? }` → executa a tarefa (whitelist) |
| GET | `/api/ssh/overview` | Clusters + servidores + último snapshot (CPU/memória/disco/rede) |
| GET | `/api/ssh/config` | Apelidos do `~/.ssh/config` disponíveis (modo Sistema) |
| GET | `/api/ssh/logo/<arquivo>` | Logo (PNG/JPG/WEBP/GIF) de um cluster/servidor (autenticado) |
| POST | `/api/ssh/clusters` | `{ name, logo? }` → cria cluster |
| POST | `/api/ssh/clusters/update` | `{ id, name?, logo? }` → renomeia e/ou troca o logo |
| POST | `/api/ssh/clusters/delete` | `{ id }` → remove cluster (servidores viram "Sem cluster") |
| POST | `/api/ssh/servers` | `{ name, host, port, username, authType, secret, clusterId, logo? }` (`authType`: key/password/system) |
| POST | `/api/ssh/servers/update` | Igual ao anterior + `id` (credencial/logo vazios mantêm os atuais) |
| POST | `/api/ssh/servers/delete` | `{ id }` |
| POST | `/api/ssh/servers/test` | `{ id }` → testa a conexão e retorna hostname/kernel |

## Estrutura

```
server/
  index.js      # servidor HTTP, rotas e gate de autenticação
  config.js     # variáveis de ambiente e caminhos
  db.js         # SQLite (node:sqlite): usuários, sessões, clusters e servidores SSH
  auth.js       # scrypt, sessões, cookies, rate limit
  secrets.js    # chave mestra local + AES-256-GCM (credenciais SSH)
  disk.js       # scan com du + SSE + cache (respeita SCAN_ROOT)
  system.js     # amostragem de /proc: CPU, memória, rede, histórico
  network.js    # /proc/net/dev, interfaces, TCP e latência
  docker.js     # CLI do Docker: containers, stats, logs, ações
  ssh.js        # coleta agente-less (ssh: sistema/chave/senha) + leitura do ~/.ssh/config + cache
  logos.js      # upload/remoção/leitura dos logos (PNG/JPG/WEBP/GIF) em data/logos/
  clean.js      # tarefas de limpeza em whitelist
src/
  App.tsx                # gate de login + layout e abas
  components/            # Dashboard, Rede, Docker, SSH, Disco, Processos, Memória, Limpeza
  components/LoginScreen.tsx
  lib/                   # api, format, usePoll
public/                  # logos (mark + wordmark) e favicon
data/                    # SQLite + master.key + logos/ (criados no 1º uso, fora do git)
```

## Identidade visual

- `public/logo-mark.png` (512×512) — header, rodapé e favicon/`apple-touch-icon`.
- `public/Logo Linux Resource com Tux e Monitor.png` — arte original usada na **tela de login**.
- `public/logo-wordmark.png` (630×630) — derivado da arte original, usado em `og:image`/`twitter:image`.
- Os PNG originais em `public/` são a fonte; os derivados são gerados via `ffmpeg`.

## Licença

MIT.
