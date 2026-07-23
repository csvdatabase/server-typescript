# syntax=docker/dockerfile:1

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime

LABEL org.opencontainers.image.title="CSDB TypeScript Server" \
      org.opencontainers.image.description="Docker-deployable JSON API for CSDB databases" \
      org.opencontainers.image.source="https://github.com/csvdatabase/server-typescript" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CSDB_DATA_DIR=/data \
    CSDB_MAX_BODY_BYTES=1048576 \
    CSDB_SHUTDOWN_TIMEOUT_MS=10000

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node LICENSE README.md ./

RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 3000
VOLUME ["/data"]
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "dist/index.js"]
