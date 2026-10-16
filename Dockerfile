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

# du (GNU coreutils, usado no scan de disco), ping (latência) e docker CLI (aba Docker)
RUN apk add --no-cache coreutils iputils docker-cli tzdata

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10450 \
    DATA_DIR=/data

COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json ./package.json

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 10450

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10450)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
