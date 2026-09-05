import type { Client } from 'pg';
import { openMirror } from './mirror';
import { openTarget } from './target';

/**
 * One pass/fail assertion produced by `verify()`. `group` names one of the
 * five check groups from the Task 5 brief (counts, referential integrity,
 * password fidelity, content sampling, audit trigger), `name` identifies the
 * specific assertion within that group, and `details` carries a short
 * human-readable explanation — always present on failure, optional on
 * success.
 */
export interface Check {
  group: string;
  name: string;
  ok: boolean;
  details?: string;
}

function ok(group: string, name: string, details?: string): Check {
  return { group, name, ok: true, details };
}

function fail(group: string, name: string, details: string): Check {
  return { group, name, ok: false, details };
}

// ---------------------------------------------------------------------------
// Group 1: row counts
// ---------------------------------------------------------------------------

/**
 * Every target table this task verifies, paired with the mirror-side query
 * that produces the expected count. Read from the mirror at runtime (rather
 * than hardcoded numbers) so this stays correct if the dump is refreshed —
 * see the brief. Two tables need a non-default query:
 *
 * - `users`: the target table is populated from `auth.users` (Task 3), not
 *   `profiles`, and only non-deleted rows are imported (mirrors
 *   `importUsers`'s own source query in `users.ts`).
 * - `shelter_history`: must equal the mirror's `shelter_history` row count
 *   verbatim. It must NOT be inflated by the audit trigger firing during the
 *   `shelters` import — that's exactly what `SHELTER_TRIGGER_SPAN` in
 *   `tables.ts` prevents at import time; this check catches a regression.
 */
export const COUNT_TABLES: {
  target: string;
  mirrorQuery: string;
}[] = [
  {
    target: 'users',
    mirrorQuery:
      'SELECT count(*)::int AS n FROM auth.users WHERE deleted_at IS NULL',
  },
  {
    target: 'shelters',
    mirrorQuery: 'SELECT count(*)::int AS n FROM shelters',
  },
  {
    target: 'volunteers',
    mirrorQuery: 'SELECT count(*)::int AS n FROM volunteers',
  },
  {
    target: 'vacancies',
    mirrorQuery: 'SELECT count(*)::int AS n FROM vacancies',
  },
  {
    target: 'vacancy_applications',
    mirrorQuery: 'SELECT count(*)::int AS n FROM vacancy_applications',
  },
  {
    target: 'shelter_dynamics',
    mirrorQuery: 'SELECT count(*)::int AS n FROM shelter_dynamics',
  },
  {
    target: 'shelter_history',
    mirrorQuery: 'SELECT count(*)::int AS n FROM shelter_history',
  },
  {
    target: 'team_memberships',
    mirrorQuery: 'SELECT count(*)::int AS n FROM team_memberships',
  },
  {
    target: 'deletion_flags',
    mirrorQuery: 'SELECT count(*)::int AS n FROM deletion_flags',
  },
  {
    target: 'wp_users_raw',
    mirrorQuery: 'SELECT count(*)::int AS n FROM wp_users_raw',
  },
  {
    target: 'wp_users_legacy',
    mirrorQuery: 'SELECT count(*)::int AS n FROM wp_users_legacy',
  },
  {
    target: 'wp_posts_raw',
    mirrorQuery: 'SELECT count(*)::int AS n FROM wp_posts_raw',
  },
  {
    target: 'wp_postmeta_raw',
    mirrorQuery: 'SELECT count(*)::int AS n FROM wp_postmeta_raw',
  },
  {
    target: 'wp_usermeta_raw',
    mirrorQuery: 'SELECT count(*)::int AS n FROM wp_usermeta_raw',
  },
  {
    target: 'shelter_volunteers',
    mirrorQuery: 'SELECT count(*)::int AS n FROM shelter_volunteers',
  },
];

/**
 * Pure comparison helper: turns a table -> {expected, actual} count map into
 * one `Check` per table. Extracted from `runCountChecks` so the diff logic
 * itself (equal vs. mismatched, message shape) is unit-testable without a
 * database.
 */
export function diffCounts(
  counts: Record<string, { expected: number; actual: number }>,
): Check[] {
  return Object.entries(counts).map(([table, { expected, actual }]) =>
    expected === actual
      ? ok('counts', table, `${actual} rows`)
      : fail(
          'counts',
          table,
          `expected ${expected} (from mirror), got ${actual} on target`,
        ),
  );
}

async function runCountChecks(
  mirror: Client,
  target: Client,
): Promise<Check[]> {
  const counts: Record<string, { expected: number; actual: number }> = {};

  for (const { target: table, mirrorQuery } of COUNT_TABLES) {
    const [{ rows: mRows }, { rows: tRows }] = await Promise.all([
      mirror.query<{ n: number }>(mirrorQuery),
      target.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`),
    ]);
    counts[table] = { expected: mRows[0].n, actual: tRows[0].n };
  }

  return diffCounts(counts);
}

// ---------------------------------------------------------------------------
// Group 2: referential integrity (target-only, every query must return 0)
// ---------------------------------------------------------------------------

const ORPHAN_QUERIES: { name: string; sql: string }[] = [
  {
    name: 'shelters.profile_id -> users',
    sql: `SELECT count(*)::int AS n FROM shelters s
          WHERE s.profile_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = s.profile_id)`,
  },
  {
    name: 'volunteers.owner_profile_id -> users',
    sql: `SELECT count(*)::int AS n FROM volunteers v
          WHERE v.owner_profile_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = v.owner_profile_id)`,
  },
  {
    name: 'vacancies.shelter_id -> shelters',
    sql: `SELECT count(*)::int AS n FROM vacancies va
          WHERE va.shelter_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM shelters s WHERE s.id = va.shelter_id)`,
  },
  {
    name: 'vacancy_applications.vacancy_id -> vacancies',
    sql: `SELECT count(*)::int AS n FROM vacancy_applications a
          WHERE a.vacancy_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM vacancies v WHERE v.id = a.vacancy_id)`,
  },
  {
    name: 'vacancy_applications.volunteer_id -> volunteers',
    sql: `SELECT count(*)::int AS n FROM vacancy_applications a
          WHERE a.volunteer_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE v.id = a.volunteer_id)`,
  },
  {
    name: 'shelter_dynamics.shelter_id -> shelters',
    sql: `SELECT count(*)::int AS n FROM shelter_dynamics d
          WHERE d.shelter_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM shelters s WHERE s.id = d.shelter_id)`,
  },
  {
    name: 'shelter_history.shelter_id -> shelters',
    sql: `SELECT count(*)::int AS n FROM shelter_history h
          WHERE h.shelter_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM shelters s WHERE s.id = h.shelter_id)`,
  },
  {
    name: 'shelter_history.profile_id -> users',
    sql: `SELECT count(*)::int AS n FROM shelter_history h
          WHERE h.profile_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = h.profile_id)`,
  },
  {
    name: 'users.creator_profile_id -> users',
    sql: `SELECT count(*)::int AS n FROM users u
          WHERE u.creator_profile_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM users c WHERE c.id = u.creator_profile_id)`,
  },
];

async function runReferentialChecks(target: Client): Promise<Check[]> {
  const checks: Check[] = [];
  for (const { name, sql } of ORPHAN_QUERIES) {
    const { rows } = await target.query<{ n: number }>(sql);
    const n = rows[0].n;
    checks.push(
      n === 0
        ? ok('referential', name)
        : fail('referential', name, `${n} orphaned row(s)`),
    );
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Group 3: password fidelity (target-only)
// ---------------------------------------------------------------------------

const PASSWORD_CHECKS: { name: string; sql: string; expected: number }[] = [
  {
    name: 'users.password_hash IS NULL',
    sql: `SELECT count(*)::int AS n FROM users WHERE password_hash IS NULL`,
    expected: 0,
  },
  {
    name: "users.password_hash NOT LIKE '$2%'",
    sql: `SELECT count(*)::int AS n FROM users WHERE password_hash NOT LIKE '$2%'`,
    expected: 0,
  },
  {
    name: "wp_users_legacy.user_pass LIKE '$P$%'",
    sql: `SELECT count(*)::int AS n FROM wp_users_legacy WHERE user_pass LIKE '$P$%'`,
    expected: 666,
  },
  {
    name: "wp_users_legacy.user_pass LIKE '$wp$%'",
    sql: `SELECT count(*)::int AS n FROM wp_users_legacy WHERE user_pass LIKE '$wp$%'`,
    expected: 304,
  },
  {
    name: 'wp_users_legacy.user_pass ~ md5',
    sql: `SELECT count(*)::int AS n FROM wp_users_legacy WHERE user_pass ~ '^[a-f0-9]{32}$'`,
    expected: 3,
  },
];

async function runPasswordChecks(target: Client): Promise<Check[]> {
  const checks: Check[] = [];
  for (const { name, sql, expected } of PASSWORD_CHECKS) {
    const { rows } = await target.query<{ n: number }>(sql);
    const n = rows[0].n;
    checks.push(
      n === expected
        ? ok('passwords', name, `${n}`)
        : fail('passwords', name, `expected ${expected}, got ${n}`),
    );
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Group 4: content sampling (10 shelters, shared key wp_post_id)
// ---------------------------------------------------------------------------

/**
 * Columns compared field-by-field between mirror and target for each
 * sampled shelter. Excludes `id`/`wp_post_id` (the join keys) and
 * `created_at`/`updated_at` (target defaults can legitimately differ from
 * the mirror's original timestamps on columns not carried by the import
 * config); every other column from the shared `shelters` import config in
 * `tables.ts` is included.
 */
export const SHELTER_SAMPLE_COLUMNS = [
  'profile_id',
  'shelter_type',
  'cnpj',
  'cpf',
  'name',
  'cep',
  'street',
  'number',
  'district',
  'state',
  'city',
  'website',
  'foundation_date',
  'species',
  'temporary_agreement',
  'referral_source',
  'initial_dogs',
  'initial_cats',
  'initial_dogs_lt',
  'initial_cats_lt',
  'authorized_name',
  'authorized_role',
  'authorized_email',
  'authorized_phone',
  'active',
  'accept_terms',
  'wp_post_author',
] as const;

/**
 * Pure comparison: given a mirror row and a target row (same shared key),
 * compares `columns` in order and returns the first mismatch found (if
 * any). Values are stringified before comparison so equivalent
 * representations (e.g. a `Date` vs. an ISO string, or `123` vs. `'123'`)
 * from different drivers/fixtures don't produce false positives; `null` and
 * `undefined` are treated as equivalent "absent" values.
 */
export interface FieldMismatch {
  column: string;
  mirrorValue: unknown;
  targetValue: unknown;
}

function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(value);
}

export function compareRows(
  mirrorRow: Record<string, unknown>,
  targetRow: Record<string, unknown>,
  columns: readonly string[],
): FieldMismatch | null {
  for (const column of columns) {
    const a = normalize(mirrorRow[column]);
    const b = normalize(targetRow[column]);
    if (a !== b) {
      return {
        column,
        mirrorValue: mirrorRow[column],
        targetValue: targetRow[column],
      };
    }
  }
  return null;
}

const SAMPLE_SIZE = 10;

async function runContentSamplingChecks(
  mirror: Client,
  target: Client,
): Promise<Check[]> {
  const { rows: sample } = await mirror.query<{ wp_post_id: number }>(
    `SELECT wp_post_id FROM shelters
     WHERE wp_post_id IS NOT NULL
     ORDER BY wp_post_id ASC
     LIMIT ${SAMPLE_SIZE}`,
  );

  if (sample.length === 0) {
    return [
      fail(
        'content-sampling',
        'sample',
        'no shelters with wp_post_id found on mirror',
      ),
    ];
  }

  const cols = SHELTER_SAMPLE_COLUMNS.join(', ');
  const checks: Check[] = [];

  for (const { wp_post_id } of sample) {
    const [{ rows: mRows }, { rows: tRows }] = await Promise.all([
      mirror.query<Record<string, unknown>>(
        `SELECT wp_post_id, ${cols} FROM shelters WHERE wp_post_id = $1`,
        [wp_post_id],
      ),
      target.query<Record<string, unknown>>(
        `SELECT wp_post_id, ${cols} FROM shelters WHERE wp_post_id = $1`,
        [wp_post_id],
      ),
    ]);

    const name = `shelter wp_post_id=${wp_post_id}`;

    if (mRows.length === 0 || tRows.length === 0) {
      checks.push(
        fail(
          'content-sampling',
          name,
          `missing on ${mRows.length === 0 ? 'mirror' : 'target'}`,
        ),
      );
      continue;
    }

    const mismatch = compareRows(mRows[0], tRows[0], SHELTER_SAMPLE_COLUMNS);
    checks.push(
      mismatch
        ? fail(
            'content-sampling',
            name,
            `column "${mismatch.column}" differs (mirror=${JSON.stringify(
              mismatch.mirrorValue,
            )}, target=${JSON.stringify(mismatch.targetValue)})`,
          )
        : ok('content-sampling', name),
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Group 5: audit trigger self-test (target-only, must leave zero residue)
// ---------------------------------------------------------------------------

/**
 * Exercises `trigger_shelter_history` end-to-end after the import: updates
 * one shelter's `name` inside a transaction with `app.user_id` set, confirms
 * a matching `shelter_history` row appeared, then restores the original name
 * and deletes exactly that one test history row.
 *
 * Deliberately does NOT rely on ROLLBACK: the trigger's own INSERT happens
 * in the same transaction as the UPDATE, so rolling back would silently
 * "pass" without ever proving the trigger fired (and would also discard the
 * row we need to read back to assert on). Instead everything commits, is
 * verified, and is then explicitly undone by primary key — leaving
 * `shelter_history`'s row count unchanged.
 */
async function runAuditTriggerCheck(target: Client): Promise<Check[]> {
  const group = 'audit-trigger';

  const { rows: candidates } = await target.query<{
    id: string;
    name: string;
    profile_id: string | null;
  }>(
    `SELECT id, name, profile_id FROM shelters WHERE profile_id IS NOT NULL LIMIT 1`,
  );

  if (candidates.length === 0) {
    return [
      fail(
        group,
        'candidate shelter',
        'no shelter with a non-null profile_id found',
      ),
    ];
  }

  const shelter = candidates[0];
  const testActorId = shelter.profile_id as string;
  const originalName = shelter.name;
  const testName = `${originalName} [verify-audit-trigger-selftest]`;

  const checks: Check[] = [];
  const historyRowIds: string[] = [];

  async function updateName(newName: string): Promise<string | null> {
    await target.query('BEGIN');
    try {
      await target.query('SELECT set_config($1, $2, true)', [
        'app.user_id',
        testActorId,
      ]);
      await target.query('UPDATE shelters SET name = $1 WHERE id = $2', [
        newName,
        shelter.id,
      ]);
      await target.query('COMMIT');
    } catch (err) {
      await target.query('ROLLBACK');
      throw err;
    }

    const { rows } = await target.query<{ id: string }>(
      `SELECT id FROM shelter_history
       WHERE shelter_id = $1
       ORDER BY changed_at DESC
       LIMIT 1`,
      [shelter.id],
    );
    return rows[0]?.id ?? null;
  }

  try {
    const historyRowId = await updateName(testName);
    if (historyRowId) historyRowIds.push(historyRowId);

    const { rows: historyRows } = await target.query<{
      id: string;
      operation: string;
      changed_by: string | null;
    }>(`SELECT id, operation, changed_by FROM shelter_history WHERE id = $1`, [
      historyRowId,
    ]);

    const history = historyRows[0];

    if (!history) {
      checks.push(
        fail(
          group,
          'history row created',
          'no shelter_history row found after UPDATE',
        ),
      );
    } else if (history.operation !== 'UPDATE') {
      checks.push(
        fail(
          group,
          'history row created',
          `expected operation UPDATE, got ${history.operation}`,
        ),
      );
    } else if (history.changed_by !== testActorId) {
      checks.push(
        fail(
          group,
          'changed_by matches app.user_id',
          `expected ${testActorId}, got ${String(history.changed_by)}`,
        ),
      );
    } else {
      checks.push(
        ok(group, 'history row created with correct operation and changed_by'),
      );
    }
  } finally {
    // Always attempt to restore the name, even if an assertion above
    // failed, so the check is safely re-runnable. This second UPDATE also
    // fires the trigger, so its history row is captured and removed too.
    const restoreHistoryRowId = await updateName(originalName);
    if (restoreHistoryRowId) historyRowIds.push(restoreHistoryRowId);

    if (historyRowIds.length > 0) {
      await target.query(`DELETE FROM shelter_history WHERE id = ANY($1)`, [
        historyRowIds,
      ]);
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function verify(): Promise<{ ok: boolean; checks: Check[] }> {
  const mirror = await openMirror();
  const target = await openTarget();

  try {
    const checks: Check[] = [
      ...(await runCountChecks(mirror, target)),
      ...(await runReferentialChecks(target)),
      ...(await runPasswordChecks(target)),
      ...(await runContentSamplingChecks(mirror, target)),
      ...(await runAuditTriggerCheck(target)),
    ];

    return { ok: checks.every((c) => c.ok), checks };
  } finally {
    await mirror.end();
    await target.end();
  }
}

function printReport(result: { ok: boolean; checks: Check[] }): void {
  const byGroup = new Map<string, Check[]>();
  for (const check of result.checks) {
    const list = byGroup.get(check.group) ?? [];
    list.push(check);
    byGroup.set(check.group, list);
  }

  for (const [group, checks] of byGroup) {
    const passed = checks.filter((c) => c.ok).length;
    console.log(`\n${group} (${passed}/${checks.length})`);
    for (const check of checks) {
      const mark = check.ok ? 'PASS' : 'FAIL';
      const detail = check.details ? ` — ${check.details}` : '';
      console.log(`  [${mark}] ${check.name}${detail}`);
    }
  }

  const totalPassed = result.checks.filter((c) => c.ok).length;
  console.log(
    `\n${result.ok ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} (${totalPassed}/${result.checks.length})`,
  );
}

async function main(): Promise<void> {
  const result = await verify();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
