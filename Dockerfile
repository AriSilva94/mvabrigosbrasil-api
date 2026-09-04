# Node 20 alpine: pinned to match the Dokploy target runtime (Node 20), even though the
# dev host runs Node 24. bcryptjs and wordpress-hash-node are pure JS (no native build), so
# alpine is sufficient — no libc6-compat / build-base needed.

FROM node:20-alpine AS deps
WORKDIR /app
# node:20-alpine ships npm 10.8.2. This repo's package-lock.json (lockfileVersion 3) was
# written by npm 11.6.2 and `npm ci` rejects it under npm 10.x *and* under newer npm 11.19.x
# with "Missing: @emnapi/core@1.11.3 from lock file" (verified empirically) — npm's lockfile
# integrity check for optional transitive deps is sensitive to the exact npm minor. Pinning
# npm to the same version that generated the lockfile is the only fix that didn't require
# touching package-lock.json itself.
RUN npm install -g npm@11.6.2
COPY package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /app
# `prisma.config.ts` calls env('DATABASE_URL') eagerly at load time, so `prisma generate`
# fails without *some* value even though generation never opens a connection. This ARG
# supplies a syntactically valid dummy that exists only in this intermediate build stage —
# it is never copied into the runner stage and never becomes part of the final image.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
ENV DATABASE_URL=$DATABASE_URL
# Prisma 7 generates the client into src/generated/prisma (see prisma/schema.prisma
# `generator client { output = "../src/generated/prisma" }`), not node_modules/.prisma.
# `prisma/` and `src/` must both be present before `prisma generate` runs, hence the full
# copy before generating.
COPY . .
RUN npx prisma generate
RUN npm run build

# `migrator`: a separate, explicitly-named target whose only job is `prisma migrate
# deploy`. The `runner` image below deliberately ships neither the Prisma CLI nor
# `prisma/` (see the comment above `COPY --from=build /app/dist ./dist`), so there is no
# way to apply migrations against it — this stage is that missing migration path. It is
# NOT the default target: `docker build .` still resolves to the last stage (`runner`)
# below, unchanged. Build this one explicitly with `--target migrator`.
#
# Based on `deps`, not `build`: `build` bakes the dummy `DATABASE_URL` ARG in as an ENV
# layer (needed only so `prisma generate` doesn't crash at load time), and that ENV would
# leak into any image built FROM it as a default env var. `deps` has the full
# `npm ci` install (Prisma CLI included, nothing omitted) but no DATABASE_URL of any kind
# baked in — this stage reads DATABASE_URL from the environment at container run time,
# like every other service in docker-compose.yml, with no default value at all.
FROM deps AS migrator
WORKDIR /app
COPY prisma ./prisma
COPY prisma.config.ts ./
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g npm@11.6.2
COPY package*.json ./
# `--omit=optional` alongside `--omit=dev` is required, not cosmetic: `prisma` and
# `typescript` are optional peerDependencies of @prisma/client that are ALSO devDependencies
# here, so npm marks them "devOptional" in the lockfile — `npm ci --omit=dev` alone keeps
# devOptional packages (removed only when BOTH dev and optional are omitted). Without
# --omit=optional the runtime image drags in the full `prisma` CLI, including Prisma
# Studio's UI bundle (react-dom, effect, elkjs, @visx, ...) — roughly 270MB of unused
# packages that are never imported at runtime (the generated client inlines the schema and
# needs neither the schema.prisma file nor the prisma/typescript CLIs).
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
# Compiled output lands at dist/src/** (tsc has no rootDir set, so it mirrors the src/
# layout including src/generated/prisma compiled to dist/src/generated/prisma/*.js). The
# Prisma 7 client inlines the datamodel into that compiled JS (see "inlineSchema" in
# dist/src/generated/prisma/internal/class.js) — the running app never reads
# prisma/schema.prisma or prisma.config.ts, so neither is copied here. There is no
# node_modules/.prisma or node_modules/@prisma/client to copy separately either —
# @prisma/client / @prisma/adapter-pg ship as regular npm dependencies already restored by
# `npm ci --omit=dev --omit=optional` above. This image never runs `prisma migrate
# deploy` — that is the `migrator` target's job (see above), built and run separately
# (docker-compose.yml wires it to run once, before `api`, via `depends_on:
# service_completed_successfully`).
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
