# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN npm install -g npm@11.6.2
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
ENV DATABASE_URL=$DATABASE_URL
COPY . .
RUN ./node_modules/.bin/prisma generate
RUN npm run build

FROM base AS tools
COPY --from=build /app ./
CMD ["npm", "run", "import:sync", "--", "--dry-run"]

FROM deps AS migrator
COPY prisma ./prisma
COPY prisma.config.ts ./
USER node
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM base AS runner
ARG APP_REVISION=local
ENV NODE_ENV=production PORT=3001 APP_REVISION=$APP_REVISION
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts docker-entrypoint.sh ./
RUN chmod 755 ./docker-entrypoint.sh
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/v1/health').then(r => r.json()).then(b => process.exit(b.status === 'ok' ? 0 : 1)).catch(() => process.exit(1))"
CMD ["./docker-entrypoint.sh"]
