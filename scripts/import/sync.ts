import { types, type Client, type CustomTypesConfig } from 'pg';
import { openMirror } from './mirror';
import { openTarget } from './target';
import {
  INSERT_COLUMNS,
  SELECT_JOINED_USERS,
  mapAuthUserToUser,
  toParamRow,
  type AuthUserRow,
} from './users';
import {
  TABLES,
  LEGACY_SEQUENCE_TABLES,
  buildSelectSql,
  nextCursor,
  rowToParams,
  type TableImportConfig,
} from './tables';

export interface SyncCounts {
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
}

const USER_CONFIG: TableImportConfig = {
  table: 'users',
  primaryKey: ['id'],
  columns: [...INSERT_COLUMNS],
};
const CONFIGS = [USER_CONFIG, ...TABLES];
const DATE_TYPES = new Set<number>([
  types.builtins.DATE,
  types.builtins.TIMESTAMP,
  types.builtins.TIMESTAMPTZ,
]);
// Date do JavaScript perde microssegundos. O parser é restrito às queries
// do snapshot, sem mudar o comportamento dos outros clientes pg do processo.
const SNAPSHOT_TYPES: CustomTypesConfig = {
  getTypeParser: (oid, format) =>
    types.getTypeParser(
      DATE_TYPES.has(oid) ? types.builtins.TEXT : oid,
      format,
    ) as (value: string) => unknown,
};

async function assertDifferentDatabases(
  mirror: Client,
  target: Client,
): Promise<void> {
  if (mirror === target)
    throw new Error('Origem e destino precisam ser bancos diferentes.');
  const sql =
    'SELECT current_database() AS db, inet_server_addr()::text AS host, inet_server_port() AS port';
  const a = await mirror.query<{ db: string; host: string; port: number }>(sql);
  const b = await target.query<{ db: string; host: string; port: number }>(sql);
  if (JSON.stringify(a.rows[0]) === JSON.stringify(b.rows[0])) {
    throw new Error('Origem e destino precisam ser bancos diferentes.');
  }
}

async function stageRows(
  target: Client,
  config: TableImportConfig,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!rows.length) return;
  const values = rows
    .map(
      (_, i) =>
        `(${config.columns
          .map(
            (col, j) =>
              `$${i * config.columns.length + j + 1}${config.jsonColumns?.includes(col) ? '::jsonb' : ''}`,
          )
          .join(', ')})`,
    )
    .join(', ');
  await target.query(
    `INSERT INTO sync_${config.table} (${config.columns.join(', ')}) VALUES ${values}`,
    rows.flatMap((row) => rowToParams(config, row)),
  );
}

async function stageSnapshot(mirror: Client, target: Client): Promise<void> {
  for (const config of CONFIGS) {
    await target.query(
      `CREATE TEMP TABLE sync_${config.table} (LIKE public.${config.table} INCLUDING DEFAULTS) ON COMMIT DROP`,
    );
  }
  const { rows: users } = await mirror.query<AuthUserRow>({
    text: SELECT_JOINED_USERS,
    types: SNAPSHOT_TYPES,
  });
  if (!users.length)
    throw new Error(
      'O snapshot de origem não contém usuários; confira o dump antes da sincronização.',
    );
  for (let i = 0; i < users.length; i += 200) {
    const rows = users.slice(i, i + 200).map((user) => {
      const values = toParamRow(mapAuthUserToUser(user));
      return {
        ...Object.fromEntries(
          INSERT_COLUMNS.map((column, index) => [column, values[index]]),
        ),
        created_at: user.created_at,
        updated_at: user.updated_at,
      };
    });
    await stageRows(target, USER_CONFIG, rows);
  }
  for (const config of TABLES) {
    let cursor: unknown[] | null = null;
    for (;;) {
      const params = cursor ? [...cursor, 500] : [500];
      const { rows } = await mirror.query<Record<string, unknown>>({
        text: buildSelectSql(config, cursor !== null),
        values: params,
        types: SNAPSHOT_TYPES,
      });
      if (!rows.length) break;
      await stageRows(target, config, rows);
      cursor = nextCursor(config, rows);
    }
  }
}

async function compareSnapshot(
  target: Client,
): Promise<Record<string, SyncCounts>> {
  const report: Record<string, SyncCounts> = {};
  for (const config of CONFIGS) {
    const join = config.primaryKey
      .map((column) => `t.${column} = s.${column}`)
      .join(' AND ');
    const targetValues = config.columns
      .map((column) => `t.${column}`)
      .join(', ');
    const sourceValues = config.columns
      .map((column) => `s.${column}`)
      .join(', ');
    const exists = `t.${config.primaryKey[0]} IS NOT NULL AND s.${config.primaryKey[0]} IS NOT NULL`;
    const differs = `ROW(${targetValues}) IS DISTINCT FROM ROW(${sourceValues})`;
    const { rows } = await target.query<SyncCounts>(`
      SELECT
        count(*) FILTER (WHERE t.${config.primaryKey[0]} IS NULL)::int AS inserted,
        count(*) FILTER (WHERE ${exists} AND ${differs})::int AS updated,
        count(*) FILTER (WHERE s.${config.primaryKey[0]} IS NULL)::int AS deleted,
        count(*) FILTER (WHERE ${exists} AND NOT (${differs}))::int AS unchanged
      FROM public.${config.table} t FULL JOIN sync_${config.table} s ON ${join}
    `);
    report[config.table] = rows[0];
  }
  return report;
}

function hasChanges(report: Record<string, SyncCounts>): boolean {
  return Object.values(report).some(
    (row) => row.inserted + row.updated + row.deleted > 0,
  );
}

async function restartSequences(target: Client): Promise<void> {
  for (const { table, pk } of LEGACY_SEQUENCE_TABLES) {
    const { rows } = await target.query<{ name: string }>(
      `
      SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname) AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.oid=pg_get_serial_sequence($1,$2)::regclass
    `,
      [table, pk],
    );
    if (!rows.length) throw new Error(`Sequence ausente em ${table}.${pk}.`);
    const maximum = await target.query<{ id: string | null }>(
      `SELECT max(${pk})::text AS id FROM public.${table}`,
    );
    const next = BigInt(maximum.rows[0].id ?? '0') + 1n;
    // ALTER SEQUENCE RESTART é transacional; setval não seria revertido
    // caso uma constraint adiada ou o commit falhasse depois deste ponto.
    await target.query(
      `ALTER SEQUENCE ${rows[0].name} RESTART WITH ${next.toString()}`,
    );
  }
}

export async function syncSnapshot(
  mirror: Client,
  target: Client,
  options: { apply?: boolean } = {},
): Promise<Record<string, SyncCounts>> {
  await assertDifferentDatabases(mirror, target);
  let mirrorTransaction = false;
  let targetTransaction = false;
  try {
    await mirror.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    mirrorTransaction = true;
    await target.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    targetTransaction = true;
    await target.query("SET LOCAL lock_timeout = '5s'");
    const lock = options.apply ? 'ACCESS EXCLUSIVE' : 'ACCESS SHARE';
    await target.query(
      `LOCK TABLE ${CONFIGS.map((c) => `public.${c.table}`).join(', ')} IN ${lock} MODE`,
    );
    if (options.apply) {
      const trigger = await target.query<{ tgenabled: string }>(
        "SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.shelters'::regclass AND tgname='trigger_shelter_history'",
      );
      if (trigger.rows[0]?.tgenabled !== 'O') {
        throw new Error(
          'O trigger de histórico deve estar ativo antes da sincronização.',
        );
      }
    }
    await stageSnapshot(mirror, target);
    const report = await compareSnapshot(target);
    if (options.apply && hasChanges(report)) {
      // A carga completa evita colisões transitórias de chaves únicas e
      // preserva apenas o histórico do snapshot, sem gerar eventos de importação.
      await target.query(
        'ALTER TABLE shelters DISABLE TRIGGER trigger_shelter_history',
      );
      for (const config of [...CONFIGS].reverse())
        await target.query(`DELETE FROM public.${config.table}`);
      for (const config of CONFIGS) {
        const columns = config.columns.join(', ');
        await target.query(
          `INSERT INTO public.${config.table} (${columns}) SELECT ${columns} FROM sync_${config.table}`,
        );
      }
      await target.query(
        'ALTER TABLE shelters ENABLE TRIGGER trigger_shelter_history',
      );
      if (hasChanges(await compareSnapshot(target)))
        throw new Error(
          'O destino diverge do snapshot; sincronização revertida.',
        );
      await restartSequences(target);
    }
    await mirror.query('COMMIT');
    mirrorTransaction = false;
    await target.query(options.apply ? 'COMMIT' : 'ROLLBACK');
    targetTransaction = false;
    return report;
  } catch (error) {
    if (targetTransaction) await target.query('ROLLBACK');
    if (mirrorTransaction) await mirror.query('ROLLBACK');
    throw error;
  }
}

export function parseSyncArgs(argv: string[]): { apply: boolean } {
  const allowed = ['--dry-run', '--apply', '--maintenance'];
  if (argv.some((arg) => !allowed.includes(arg)))
    throw new Error('Use --dry-run ou --apply --maintenance.');
  const apply = argv.includes('--apply');
  if (
    apply &&
    (argv.includes('--dry-run') || !argv.includes('--maintenance'))
  ) {
    throw new Error(
      'Aplicar exige --apply --maintenance, com origem e destino em manutenção.',
    );
  }
  return { apply };
}

async function main(): Promise<void> {
  const options = parseSyncArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL || !process.env.MIRROR_DATABASE_URL) {
    throw new Error(
      'Defina DATABASE_URL e MIRROR_DATABASE_URL explicitamente.',
    );
  }
  const mirror = await openMirror();
  let target: Client | undefined;
  try {
    target = await openTarget();
    const report = await syncSnapshot(mirror, target, options);
    console.log(
      options.apply
        ? 'Snapshot sincronizado e validado.'
        : 'Prévia: nenhuma alteração persistida no destino.',
    );
    console.table(report);
  } finally {
    await target?.end();
    await mirror.end();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Falha na sincronização.',
    );
    process.exitCode = 1;
  });
}
