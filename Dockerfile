# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- runtime ----------
FROM node:24-alpine AS run
WORKDIR /app

# du (GNU coreutils, scan de disco), ping (latência), docker CLI (aba Docker),
# openssh-client + sshpass (aba SSH: chave e senha), pciutils (lspci para detecção de GPU),
# iproute2 (interfaces/IPs do host), su-exec (ajuste dinâmico do GID do docker.sock)
RUN apk add --no-cache coreutils iputils iproute2 docker-cli tzdata openssh-client sshpass pciutils su-exec

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10450 \
    DATA_DIR=/data

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /data && chown -R node:node /data && \
    printf '#!/bin/sh\nset -e\nif [ "$(id -u)" = "0" ]; then\n  mkdir -p "${DATA_DIR:-/data}" && chown -R node:node "${DATA_DIR:-/data}" 2>/dev/null || true\n  if [ -S /var/run/docker.sock ]; then\n    SOCK_GID=$(stat -c "%%g" /var/run/docker.sock 2>/dev/null || true)\n    if [ -n "$SOCK_GID" ] && [ "$SOCK_GID" != "0" ]; then\n      GRP_NAME=$(awk -F: -v gid="$SOCK_GID" "\$3 == gid { print \$1; exit }" /etc/group)\n      if [ -z "$GRP_NAME" ]; then\n        GRP_NAME="dockersock"\n        addgroup -g "$SOCK_GID" -S "$GRP_NAME" 2>/dev/null || true\n      fi\n      addgroup node "$GRP_NAME" 2>/dev/null || true\n    elif [ "$SOCK_GID" = "0" ]; then\n      chmod g+rw /var/run/docker.sock 2>/dev/null || true\n    fi\n  fi\n  exec su-exec node "$@"\nfi\nexec "$@"\n' > /entrypoint.sh && chmod +x /entrypoint.sh

VOLUME ["/data"]
EXPOSE 10450

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10450)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
