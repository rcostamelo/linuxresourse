# Linux Resource

Painel web para **gerenciar, monitorar e otimizar** desktops e servidores Linux: disco,
processos, memória, rede e Docker — tudo em uma única UI, com **login** e sem dependências
nativas.

- **Backend**: Node puro (sem framework), dados lidos de `/proc`, `/sys`, `du` e Docker.
- **Frontend**: React + Vite + shadcn/ui (tema escuro), gráficos em SVG feitos à mão.
- **Usuários e sessões**: SQLite nativo (`node:sqlite`), senhas com `scrypt`, cookie `HttpOnly`.
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

## Estrutura

```
server/
  index.js      # servidor HTTP, rotas e gate de autenticação
  config.js     # variáveis de ambiente e caminhos
  db.js         # SQLite (node:sqlite): usuários e sessões
  auth.js       # scrypt, sessões, cookies, rate limit
  disk.js       # scan com du + SSE + cache (respeita SCAN_ROOT)
  system.js     # amostragem de /proc: CPU, memória, rede, histórico
  network.js    # /proc/net/dev, interfaces, TCP e latência
  docker.js     # CLI do Docker: containers, stats, logs, ações
  clean.js      # tarefas de limpeza em whitelist
src/
  App.tsx                # gate de login + layout e abas
  components/            # Dashboard, RedePanel, DockerPanel, Disco, Processos, Memória, Limpeza
  components/LoginScreen.tsx
  lib/                   # api, format, usePoll
public/                  # logos (mark + wordmark) e favicon
data/                    # SQLite (criado no 1º uso, fora do git)
```

## Identidade visual

- `public/logo-mark.png` (512×512) — header, rodapé e favicon/`apple-touch-icon`.
- `public/Logo Linux Resource com Tux e Monitor.png` — arte original usada na **tela de login**.
- `public/logo-wordmark.png` (630×630) — derivado da arte original, usado em `og:image`/`twitter:image`.
- Os PNG originais em `public/` são a fonte; os derivados são gerados via `ffmpeg`.

## Licença

MIT.
