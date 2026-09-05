import type { Client } from 'pg';
import { openMirror } from './mirror';
import { openTarget } from './target';
import { importUsers } from './users';
import {
  copyTable,
  buildSequenceResetSql,
  LEGACY_SEQUENCE_TABLES,
  SHELTER_TRIGGER_SPAN,
  TABLES,
  type CopyResult,
} from './tables';

const SHELTER_HISTORY_TRIGGER = 'trigger_shelter_history';

async function runUsers(mirror: Client, target: Client): Promise<CopyResult> {
  const usersResult = await importUsers(mirror, target);
  return { read: usersResult.inserted + usersResult.skipped, ...usersResult };
}

/**
 * Dry-run counterpart of `importUsers`: reports what it would insert without
 * ever calling `importUsers` itself, since that function always issues real
 * INSERTs (relying on `ON CONFLICT DO NOTHING` to make them no-ops rather
 * than skipping them). Mirrors `importUsers`'s own source query (non-deleted
 * `auth.users`) and checks existing ids on the target — both read-only.
 */
async function dryRunUsers(
  mirror: Client,
  target: Client,
): Promise<CopyResult> {
  const { rows } = await mirror.query<{ id: string }>(
    'SELECT id FROM auth.users WHERE deleted_at IS NULL',
  );
  const ids = rows.map((r) => r.id);
  const { rows: existing } = await target.query<{ id: string }>(
    'SELECT id FROM users WHERE id = ANY($1)',
    [ids],
  );
  return {
    read: ids.length,
    inserted: ids.length - existing.length,
    skipped: existing.length,
  };
}

export interface ImportAllOptions {
  dryRun?: boolean;
  /** Restrict the run to a single table name (or `'users'`). Matches the CLI's `--only=<table>`. */
  only?: string;
}

export type ImportAllResult = Record<string, CopyResult>;

/**
 * Runs every table import in dependency order: `users` (Task 3) first, then
 * every table in `TABLES` (also dependency-ordered - see tables.ts).
 *
 * `trigger_shelter_history` is disabled before the run touches `shelters`
 * and re-enabled only after it is done with `shelter_history`, wrapped in
 * try/finally so it is always re-enabled even if an import in between
 * throws. This also guards a `--only=shelters` or `--only=shelter_history`
 * run, which writes directly into one of the two tables without going
 * through the other -- a partial import left unguarded would forge bogus
 * history rows. Skipped entirely in dry-run mode (nothing is written
 * either way) and when `--only` restricts the run to a table outside the
 * span.
 *
 * After the four legacy WordPress tables with a `SERIAL`/`BIGSERIAL`
 * primary key are imported, their sequence is reset to `MAX(pk)` so the
 * next real insert doesn't collide with an explicitly-inserted legacy id.
 * Skipped in dry-run mode (nothing was written).
 */
export async function importAll(
  mirror: Client,
  target: Client,
  options: ImportAllOptions = {},
): Promise<ImportAllResult> {
  const dryRun = options.dryRun ?? false;
  const only = options.only;

  const results: ImportAllResult = {};

  if (!only || only === 'users') {
    results.users = dryRun
      ? await dryRunUsers(mirror, target)
      : await runUsers(mirror, target);
  }

  const tablesToRun = only ? TABLES.filter((t) => t.table === only) : TABLES;

  // A full run always contains both span endpoints, so this also covers
  // that case. A `--only=shelters` (or `--only=shelter_history`) run
  // contains just one endpoint but still writes directly into shelters or
  // shelter_history, so it must guard the trigger too -- otherwise a
  // partial import would forge bogus history rows (see SHELTER_TRIGGER_SPAN's
  // doc comment in tables.ts).
  const touchesShelterTriggerSpan = tablesToRun.some(
    (t) =>
      t.table === SHELTER_TRIGGER_SPAN.from ||
      t.table === SHELTER_TRIGGER_SPAN.to,
  );
  const needsTriggerToggle = !dryRun && touchesShelterTriggerSpan;

  const runCopies = async () => {
    for (const config of tablesToRun) {
      results[config.table] = await copyTable(mirror, target, config, {
        dryRun,
      });

      if (!dryRun) {
        const legacy = LEGACY_SEQUENCE_TABLES.find(
          (l) => l.table === config.table,
        );
        if (legacy) {
          await target.query(buildSequenceResetSql(legacy.table, legacy.pk));
        }
      }
    }
  };

  if (needsTriggerToggle) {
    await target.query(
      `ALTER TABLE shelters DISABLE TRIGGER ${SHELTER_HISTORY_TRIGGER}`,
    );
    try {
      await runCopies();
    } finally {
      await target.query(
        `ALTER TABLE shelters ENABLE TRIGGER ${SHELTER_HISTORY_TRIGGER}`,
      );
    }
  } else {
    await runCopies();
  }

  return results;
}

interface CliArgs {
  dryRun: boolean;
  only?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const dryRun = argv.includes('--dry-run');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg?.slice('--only='.length);
  return { dryRun, only };
}

function printReport(results: ImportAllResult, dryRun: boolean): void {
  const label = dryRun ? '[dry-run] would insert' : 'inserted';
  console.log(
    `\n${dryRun ? 'DRY RUN — nothing was written' : 'Import complete'}`,
  );
  console.log(
    'table'.padEnd(24),
    'read'.padStart(8),
    label.padStart(16),
    'skipped'.padStart(10),
  );
  for (const [table, r] of Object.entries(results)) {
    console.log(
      table.padEnd(24),
      String(r.read).padStart(8),
      String(r.inserted).padStart(16),
      String(r.skipped).padStart(10),
    );
  }
}

async function main(): Promise<void> {
  const { dryRun, only } = parseArgs(process.argv.slice(2));

  // `openTarget()` runs only after `openMirror()` has already succeeded, so
  // a failure there must still close the mirror client it already opened.
  // `target` starts undefined and is only closed once actually assigned.
  const mirror = await openMirror();
  let target: Awaited<ReturnType<typeof openTarget>> | undefined;

  try {
    target = await openTarget();
    const results = await importAll(mirror, target, { dryRun, only });
    printReport(results, dryRun);
  } finally {
    await mirror.end();
    await target?.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
