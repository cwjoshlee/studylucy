FROM node:22.23.1-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM node:22.23.1-bookworm-slim AS runtime

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=8787

WORKDIR /app

RUN mkdir -p /data \
  && chown 1000:1000 /data

COPY --from=build --chown=1000:1000 /app/package.json /app/package-lock.json ./
COPY --from=build --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/api/health').then(async response => { if (!response.ok || (await response.json()).status !== 'ok') process.exit(1) }).catch(() => process.exit(1))"]

USER 1000:1000
CMD ["npm", "start"]
