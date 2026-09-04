# mvabrigosbrasil-api

NestJS backend for MV Abrigos Brasil. This service is the foundation that will
replace Supabase as the production data layer: Postgres via Prisma, Redis for
caching/session support, environment validation, health checks, and the
legacy WordPress password-verification path needed to migrate existing users.

This is the **foundation** only. Auth endpoints (login, refresh, cookies,
`ValidationPipe`/`class-validator` wiring) are a later phase and are not part
of this branch.

## Prerequisites

- Node.js 20+
- Docker (for Postgres and Redis)

## 1. Bring up Postgres and Redis

```bash
docker compose up -d postgres redis
```

This starts:

- Postgres, reachable on the **host** at `localhost:5433` (container port
  5432 — 5432 is already used by another project on this machine).
- Redis, reachable on the **host** at `localhost:6380` (container port 6379,
  same reasoning).

Inside the Docker network (i.e. from the `api`/`migrator` services) both are
reachable on their default ports (`postgres:5432`, `redis:6379`).

## 2. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`:

- `AUTH_JWT_SECRET` must be at least 32 characters. Generate one with:

  ```bash
  openssl rand -hex 64
  ```

- `DATABASE_URL` / `REDIS_URL` already default to the host ports above
  (5433/6380); adjust only if your local setup differs.

## 3. Run migrations

```bash
npx prisma generate
npx prisma migrate deploy
```

## 4. Run the app

Development (watch mode):

```bash
npm install
npm run start:dev
```

Production:

```bash
npm run build
npm run start:prod
```

The API is served under the `/api/v1` prefix, e.g. `GET /api/v1/health`.

## 5. Tests

```bash
npm test          # unit tests
npm run test:e2e  # e2e smoke test (boots AppModule, hits /api/v1/health)
npm run test:cov  # coverage
```

## 6. Docker build targets

The `Dockerfile` has two relevant targets (the default `docker build .`
resolves to `runner`):

- `runner` — the application image. Built and run by the `api` service in
  `docker-compose.yml`.
- `migrator` — runs `prisma migrate deploy` against the configured
  `DATABASE_URL` and exits. Build explicitly with:

  ```bash
  docker compose build migrator
  ```

  The `api` service depends on `migrator` completing successfully before it
  starts, so migrations are always applied before the app boots when using
  `docker compose up`.

## Notes

- `GET /api/v1/health` returns `200` with `{"status","db","redis"}`. Status
  is `degraded` (not a non-2xx code) when a dependency is down, so container
  health checks don't restart an app that is still serving traffic.
- The app boots successfully even if Redis is unreachable at startup; Redis
  reconnects on its own once available.
