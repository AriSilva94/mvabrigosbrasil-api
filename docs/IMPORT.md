# Data Import Procedure

This document describes the complete end-to-end procedure to migrate data from the Supabase mirror into the target NestJS database. Follow these steps to bring up a disposable mirror, restore the production dump, apply the target schema, and verify data integrity.

## Overview

The import process consists of five stages:

1. **Prerequisites** — Ensure Docker is available and the dump location is accessible
2. **Mirror Setup** — Bring up a disposable Postgres mirror and restore the Supabase dump
3. **Target Schema** — Apply Prisma migrations to the target database
4. **Data Import** — Run the orchestrator to copy data from mirror to target
5. **Verification** — Run checks to confirm data integrity, row counts, and referential integrity

## Prerequisites

### System Requirements

- **Docker** — must be installed and running. Verify with `docker --version`.
- **Node.js 20+** — required to run the TypeScript import and verification scripts.
- **Bash** — the import scripts use Bash for container orchestration.

### Dump Location

The Supabase production dump is stored externally and is read-only:

```
C:/Users/ariov/Desktop/projetos/BACKUP_SUPABASE/mvabrigos-supabase-database-backup/prisma/backups/04-09-2026/
```

This directory contains two files:
- `schema.sql` — Supabase schema (extensions, auth schema, and all DDL)
- `data.sql` — All production data

**Important:** The dump is never copied into the repo and is never written to. It is referenced by path during the restore process.

### Environment Configuration

Ensure the target database credentials are configured. The import scripts use:

- **Mirror:** `postgresql://mirror:mirror@localhost:5434/supabase_mirror`
- **Target:** `postgresql://mv:mv@localhost:5433/mvabrigos` (or the value of `DATABASE_URL` if set)

If using Docker Compose to run the target Postgres locally, start it:

```bash
docker compose up -d postgres
```

## Stage 1: Mirror Setup

The mirror is a disposable Postgres instance that holds the Supabase dump. It runs on host port `5434` and must never become the application database.

### 1.1 Bring up the Mirror Container

```bash
docker compose -f docker-compose.mirror.yml up -d
```

This starts a container named `mv-mirror` with:
- Image: `postgres:16-alpine`
- User: `mirror`, Password: `mirror`, Database: `supabase_mirror`
- Host port: `5434`

Verify the container is ready:

```bash
docker ps | grep mv-mirror
```

### 1.2 Restore the Dump

The restore process has three steps, handled by the committed script:

```bash
./scripts/import/restore-mirror.sh
```

This script:

1. **Applies bootstrap** — Creates the `extensions` and `auth` schemas and the `auth.users` table. The plain Postgres image does not have these; the bootstrap ensures the dump's schema DDL can succeed.

2. **Restores schema** — Loads `schema.sql` from the dump. Some Supabase-specific role and extension errors are expected and ignored (`ON_ERROR_STOP=0`).

3. **Restores data** — Loads `data.sql` from the dump. Storage and extra auth errors are expected and ignored.

On success, the script prints the command to verify counts:

```bash
docker exec -i mv-mirror psql -U mirror -d supabase_mirror -c \
  "SELECT 'auth.users' t, count(*) FROM auth.users UNION ALL \
   SELECT 'profiles', count(*) FROM public.profiles UNION ALL \
   SELECT 'shelters', count(*) FROM public.shelters UNION ALL \
   SELECT 'shelter_dynamics', count(*) FROM public.shelter_dynamics UNION ALL \
   SELECT 'wp_users_legacy', count(*) FROM public.wp_users_legacy;"
```

A successful restore shows that `auth.users` and other tables are populated.

### 1.3 Expected Dump State

After restore, the mirror contains the production Supabase data. The import verifier later checks that row counts match, but the raw counts on the mirror are:

| Table                | Count |
|:-------------------|------:|
| users (auth.users) |   446 |
| shelters           |   337 |
| volunteers         |   277 |
| vacancies          |    55 |
| vacancy_applications |    39 |
| shelter_dynamics   | 1,369 |
| shelter_history    | 1,025 |
| team_memberships   |    46 |
| deletion_flags     |     4 |
| wp_users_raw       |   973 |
| wp_users_legacy    |   973 |
| wp_posts_raw       | 2,482 |
| wp_postmeta_raw    |28,344 |
| wp_usermeta_raw    |17,804 |
| shelter_volunteers |     0 |

These counts are queries from the mirror's Supabase snapshot; the import later reproduces them on the target.

## Stage 2: Target Schema

Before importing data, the target schema must be prepared by running Prisma migrations.

### 2.1 Generate Prisma Client

```bash
npx prisma generate
```

This generates the Prisma client from `prisma/schema.prisma`.

### 2.2 Apply Migrations

```bash
npx prisma migrate deploy
```

This applies all pending migrations to the target database (`mv-pg` on port `5433`). The migrations create the full schema required for the import to succeed. If all migrations have been applied already, the command reports no changes.

Migrations are idempotent; running this command multiple times is safe.

## Stage 3: Data Import

The import orchestrator (`scripts/import/index.ts`) copies data from the mirror to the target in dependency order, respecting foreign keys and applying `ON CONFLICT DO NOTHING` so re-running is a no-op on already-present rows.

### 3.1 Full Import

To import all tables:

```bash
npx ts-node scripts/import/index.ts
```

On success, the script prints a table with row counts:

```
Import complete
table                      read         inserted    skipped
users                       446             446          0
wp_users_raw                973             973          0
wp_users_legacy             973             973          0
wp_posts_raw              2482            2482          0
wp_postmeta_raw          28344           28344          0
wp_usermeta_raw          17804           17804          0
shelters                   337             337          0
volunteers                 277             277          0
vacancies                   55              55          0
vacancy_applications        39              39          0
shelter_dynamics          1369            1369          0
shelter_volunteers          0               0          0
shelter_history           1025            1025          0
team_memberships           46              46          0
deletion_flags              4               4          0
```

The `inserted` column shows new rows added; `skipped` shows rows already present (from a previous run). The import is **idempotent** — running it multiple times will not duplicate rows.

### 3.2 Dry-Run Mode

To preview what the import would do without writing:

```bash
npx ts-node scripts/import/index.ts --dry-run
```

A dry-run executes all the same queries as a real import but without issuing INSERT statements. The report shows `would insert` instead of `inserted` and confirms the counts without changing the target.

### 3.3 Single-Table Import

To import only one table (useful for debugging or re-running a single table):

```bash
npx ts-node scripts/import/index.ts --only=shelters
```

Supported table names: `users`, `wp_users_raw`, `wp_users_legacy`, `wp_posts_raw`, `wp_postmeta_raw`, `wp_usermeta_raw`, `shelters`, `volunteers`, `vacancies`, `vacancy_applications`, `shelter_dynamics`, `shelter_volunteers`, `shelter_history`, `team_memberships`, `deletion_flags`.

### 3.4 Important Behaviors

- **Audit Trigger:** The `trigger_shelter_history` audit trigger is disabled during the `shelters` import and re-enabled only after `shelter_history` is imported. This prevents spurious history rows from firing during the bulk insert. The trigger is automatically restored even if an error occurs.

- **Sequence Reset:** For the four legacy WordPress tables (`wp_users_raw`, `wp_posts_raw`, `wp_postmeta_raw`, `wp_usermeta_raw`), which use `SERIAL`/`BIGSERIAL` primary keys, the sequence is automatically reset to the maximum inserted ID so the next non-imported insert does not collide.

- **Batch Size:** The import reads and inserts in batches of 500 rows per round-trip to the mirror. This can be tuned in `scripts/import/tables.ts` via the `batchSize` field if needed.

## Stage 4: Verification

After importing, verify data integrity by running the dedicated verification script. This script checks row counts, referential integrity, password fidelity, and audit trigger correctness.

### 4.1 Run Verification

```bash
npx ts-node scripts/import/verify.ts
```

A passing run prints:

```
counts (15/15)
  [PASS] users — 446 rows
  [PASS] shelters — 337 rows
  [PASS] volunteers — 277 rows
  [PASS] vacancies — 55 rows
  [PASS] vacancy_applications — 39 rows
  [PASS] shelter_dynamics — 1369 rows
  [PASS] shelter_history — 1025 rows
  [PASS] team_memberships — 46 rows
  [PASS] deletion_flags — 4 rows
  [PASS] wp_users_raw — 973 rows
  [PASS] wp_users_legacy — 973 rows
  [PASS] wp_posts_raw — 2482 rows
  [PASS] wp_postmeta_raw — 28344 rows
  [PASS] wp_usermeta_raw — 17804 rows
  [PASS] shelter_volunteers — 0 rows

referential (9/9)
  [PASS] shelters.profile_id -> users
  [PASS] volunteers.owner_profile_id -> users
  [PASS] vacancies.shelter_id -> shelters
  [PASS] vacancy_applications.vacancy_id -> vacancies
  [PASS] vacancy_applications.volunteer_id -> volunteers
  [PASS] shelter_dynamics.shelter_id -> shelters
  [PASS] shelter_history.shelter_id -> shelters
  [PASS] shelter_history.profile_id -> users
  [PASS] users.creator_profile_id -> users

passwords (5/5)
  [PASS] users.password_hash IS NULL — 0
  [PASS] users.password_hash NOT LIKE '$2%' — 0
  [PASS] wp_users_legacy.user_pass LIKE '$P$%' — 666
  [PASS] wp_users_legacy.user_pass LIKE '$wp$%' — 304
  [PASS] wp_users_legacy.user_pass ~ md5 — 3

content-sampling (10/10)
  [PASS] shelter wp_post_id=<N>
  [PASS] shelter wp_post_id=<N>
  ... (8 more shelters)

audit-trigger (1/1)
  [PASS] history row created with correct operation and changed_by

ALL CHECKS PASSED (40/40)
```

Exit code is 0 on success, 1 if any check fails.

### 4.2 What Each Check Group Validates

**Counts:** Each table's row count on the target matches the expected count from the mirror (except `users`, which is counted from non-deleted `auth.users` rows per the import logic).

**Referential Integrity:** For every foreign key relationship, no orphaned rows exist on the target. For example, every `vacancies.shelter_id` points to an actual row in `shelters`.

**Passwords:** Password format fidelity is checked:
- All `users.password_hash` entries must be bcrypt (`$2a$10$...` format).
- Legacy `wp_users_legacy.user_pass` entries must be in their original formats (phpass `$P$`, WordPress `$wp$`, or MD5).

**Content Sampling:** A sample of 10 shelters is compared row-by-row between mirror and target across all imported columns to catch data transformation bugs.

**Audit Trigger:** The `trigger_shelter_history` trigger is exercised end-to-end: a test shelter is updated, a history row is verified to appear with the correct `operation` and `changed_by`, the original name is restored, and the test history row is removed. The database state is unchanged.

### 4.3 Troubleshooting Mismatched Counts

If a row count does not match:

1. **Verify the mirror dump is current:** The verification script compares against counts read from the mirror at runtime, so if the dump is stale, counts will diverge.

2. **Check for errors during import:** Re-run the import in dry-run mode (`--dry-run`) to confirm no errors occurred. If `--dry-run` shows the expected counts but a real run diverged, check application logs for constraint violations or other write errors.

3. **Inspect specific rows:** Use direct SQL queries against the target to locate missing or unexpected rows:
   ```bash
   psql -h localhost -p 5433 -U mv -d mvabrigos -c \
     "SELECT count(*) FROM shelters WHERE <condition>"
   ```

4. **Re-run the import:** The import is idempotent. You can safely re-run it to pick up missing rows. If needed, delete and re-import a single table with `--only=<table>` after clearing it on the target.

## Stage 5: Tear Down the Mirror

Once verification passes, the mirror can be safely shut down. It is disposable and must never be used as the application database.

```bash
docker compose -f docker-compose.mirror.yml down
```

This stops and removes the `mv-mirror` container. The data is not persisted; the next import will require another restore from the dump.

## Open Items and Limitations

### Re-executability Without Sync

**The import is re-runnable (idempotent) but does NOT sync.**

- **Re-runnable:** Running the import multiple times will not duplicate rows. The `ON CONFLICT DO NOTHING` clause ensures that rows already on the target are skipped.

- **Not syncing:** If a row is modified in Supabase *after* the 2026-09-04 dump, those changes will not be picked up by the import. The import only copies rows that exist in the dump; it does not detect deletes, updates, or new inserts.

**For the final cutover, use `npm run import:sync` described below.** The original importer remains insert-only. The new command reconciles a complete, current snapshot, including updates and deletions, instead of relying on an incomplete timestamp delta.

### Timestamp Precision Below the Millisecond

Both the mirror and the target declare `timestamp(6)` (microsecond precision) for columns like `created_at`/`updated_at`, so the schema itself is faithful. The import path is not: `node-pg` round-trips these columns through JavaScript's `Date` object, which only carries millisecond resolution, so any sub-millisecond component the mirror stored is silently truncated when copied to the target.

This limitation remains in the original importer. The final snapshot synchronizer reads dates/timestamps as text with query-local pg parsers, including raw user timestamps, preserving microseconds without changing application-wide parsers.

### Password Format Validation Status

The password verification path in `src/auth/password/` supports four legacy formats: bcrypt (Supabase GoTrue), WordPress `$wp$2y$`, phpass (`$P$`/`$H$`), and MD5. Positive-case verification has been completed for bcrypt and `$wp$` against real production hashes.

**One format still needs a production account with a known password:**

1. **phpass (`$P$`/`$H$`) positive case:** The fixture is generated by the same library that verifies it, so a shared implementation bug could pass undetected. Real production hashes with known passwords are needed to prove correctness.

The `$wp$` verifier now accepts the official WordPress HMAC-SHA384/base64 input and retains the previous HTML-escaped input as a fallback. Independent algorithm tests cover `&`, `<`, `>`, quotes, backslash and Unicode; existing custom-format fixtures remain accepted. The official WordPress hashing step does not call `htmlspecialchars`. A real-account smoke test remains part of cutover validation.

For details, see `src/auth/password/__fixtures__/README.md` in this repo.

## Sincronização final de snapshot (18/10/2026)

O comando `import:sync` resolve atualizações e exclusões que o import inicial ignora. Ele trata o mirror como fonte autoritativa para as 15 tabelas migradas, incluindo hashes e flags de migração. Não é replicação contínua e não deve ser usado depois que o NestJS passou a receber dados reais.

### Procedimento de cutover

1. Ensaiar todo o procedimento em homologação. Fazer backup do destino e manter um plano de rollback de banco e roteamento.
2. Parar gravações no site antigo/Supabase e no destino NestJS. Extrair um dump atualizado depois de interromper as gravações. Restaurar em um mirror novo e vazio; o script de restore aceita `DUMP_DIR` e seu valor padrão ainda aponta para o backup antigo de setembro. Não restaurar o novo dump por cima de um mirror já populado.
3. Aplicar as migrations do destino. A API precisa estar parada durante a aplicação do snapshot; a opção `--maintenance` declara que essa condição foi atendida, não ativa manutenção automaticamente.
4. Configurar explicitamente as duas conexões no processo que executará a ferramenta. Ela não usa os defaults locais e não carrega `.env` automaticamente:

```powershell
$env:MIRROR_DATABASE_URL = '<conexão do mirror com o dump atualizado>'
$env:DATABASE_URL = '<conexão do PostgreSQL de destino>'
npm run import:sync -- --dry-run
```

5. Revisar as contagens de `inserted`, `updated`, `deleted` e `unchanged` por tabela. O relatório não mostra hashes nem senhas. Dados exclusivos do destino serão removidos na aplicação: para homologação, isso inclui contas/dados sintéticos. Se houver dados reais exclusivos do destino, interromper e resolver a origem autoritativa antes da carga.
6. Aplicar durante a janela de manutenção:

```powershell
npm run import:sync -- --apply --maintenance
npm run import:sync -- --dry-run
```

A segunda prévia deve mostrar zero inclusões, alterações e exclusões. Uma falha retorna código 1. A comparação cobre todos os registros e todas as colunas declaradas na configuração de importação, inclusive hashes byte a byte. Campos de usuário são comparados após o mapeamento necessário de `auth.users`/`profiles` para `users`.

7. Invalidar as sessões de refresh, os tokens de reset e o cache de dados públicos no Redis exclusivo deste ambiente antes de reabrir a API. Uma carga do banco não invalida automaticamente sessões/cache já presentes no Redis. Também reiniciar/revalidar o cache do NextJS. Isso evita servir dados antigos ou conservar sessões de contas removidas. Não apagar bancos Redis de outros projetos.
8. Fazer smoke com contas Supabase e WordPress conhecidas, reset/troca de senha, vínculos e permissões. Depois alterar o roteamento e reabrir o site, mantendo o Supabase sem novas gravações.

### Garantias e limites

- A origem fica em transação `REPEATABLE READ READ ONLY`. A prévia cria apenas staging temporário no destino e termina com rollback.
- A aplicação bloqueia as tabelas de destino, usa staging temporário e substitui o conteúdo em uma única transação. Essa substituição integral permite também trocas de e-mails/valores únicos, inclusões e exclusões que um upsert simples não resolve sozinho.
- O trigger de histórico deve começar ativo. Ele é desabilitado apenas dentro da transação de aplicação, e o histórico do snapshot é copiado sem eventos artificiais.
- Foreign keys permanecem ativas. Erros de integridade, de validação ou de commit revertem dados e estado do trigger. As sequences usam `ALTER SEQUENCE RESTART`, também transacional.
- Origem e destino iguais e snapshots sem usuários são rejeitados. Uma tentativa de lock aguarda no máximo cinco segundos.
- O esquema deve corresponder às migrations versionadas. Não usar com tabelas adicionais que referenciem os dados migrados sem revisar o escopo de integridade e exclusões.
- A ferramenta compara o destino ao snapshot restaurado; ela não prova que o dump foi extraído na hora correta nem que seu restore foi completo. Conferir procedência, erros de restore e contagens do dump antes da aplicação.
- O verificador antigo `scripts/import/verify.ts` mantém contagens fixas de formatos WordPress para o snapshot de setembro. Para uma carga atualizada, usar a comparação integral do novo comando; divergência dessas contagens antigas não demonstra falha da sincronização.

### Testes isolados da sincronização

Preparar dois bancos descartáveis com nomes terminando em `_sync_source` e `_sync_target` e aplicar as migrations em ambos. Não apontar estes testes a um mirror/destino real: os testes limpam as 15 tabelas de seus bancos isolados.

```powershell
$env:SYNC_TEST_MIRROR_URL = '<conexão do banco descartável *_sync_source>'
$env:SYNC_TEST_TARGET_URL = '<conexão do banco descartável *_sync_target>'
npm run test:sync
```

As views de `auth.users` e `profiles` necessárias aos dados sintéticos são preparadas pelos testes no banco source. A suíte cobre prévia, cópia literal de hash, flags, vínculos, exclusões, idempotência, e-mails reassociados, timestamps com microssegundos, rollback de foreign key/commit e preservação transacional de sequences.

## Summary

A complete import from fresh takes approximately:

1. **Mirror setup & restore:** 2–3 minutes (depends on dump size and disk speed)
2. **Target schema:** 1–2 minutes (Prisma migration)
3. **Data import:** 1–2 minutes (depends on mirror and target database speed)
4. **Verification:** 30 seconds–1 minute
5. **Total:** ~5–9 minutes

The initial importer is idempotent. The snapshot synchronizer must follow the maintenance and authoritative-source conditions above. Restore a fresh dump into a fresh mirror; do not layer restores onto an existing populated database. The mirror is disposable and can be removed after validation.
