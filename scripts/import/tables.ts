import type { Client } from 'pg';

/**
 * Declarative description of one mirror -> target table copy.
 *
 * `columns` MUST be an explicit, hand-checked intersection of the mirror's
 * and the target's real columns (see `\d public.<table>` on both databases).
 * Never `SELECT *`: the two schemas are allowed to drift (e.g. `shelters`
 * has `wp_post_author` on both sides but `shelter_dynamics.wp_post_id` only
 * exists on the target), and `SELECT *` would silently break or insert into
 * the wrong position the moment either side changes.
 */
export interface TableImportConfig {
  /** Table name, identical on mirror and target. */
  table: string;
  /**
   * Primary key column(s), in the order used for `ORDER BY` / keyset
   * pagination and for `ON CONFLICT (...)`. Almost always a single UUID or
   * integer column; `shelter_volunteers` is the one table with a composite
   * key and no surrogate `id`.
   */
  primaryKey: string[];
  /** Explicit column list to SELECT from the mirror and INSERT into the target, in this order. */
  columns: string[];
  /**
   * Columns that are `json`/`jsonb` on both sides. Read as `col::text` and
   * inserted with a `::jsonb` cast, so whatever shape the mirror actually
   * stores (array, object, or - as with 33 `shelters.additional_species`
   * rows - a bare JSON string) is copied byte-for-byte. Relying on node-pg's
   * automatic JS<->jsonb coercion would stringify that JSON-string case
   * incorrectly (a raw JS string parameter is sent unquoted, producing
   * invalid JSON), so every jsonb column is round-tripped as text instead.
   */
  jsonColumns?: string[];
  /** Rows fetched (and inserted) per round-trip. Defaults to 500 per the brief. */
  batchSize?: number;
}

export const DEFAULT_BATCH_SIZE = 500;

function selectColumnSql(config: TableImportConfig, column: string): string {
  return config.jsonColumns?.includes(column) ? `${column}::text` : column;
}

/**
 * Builds the mirror-side SELECT for one page. With no cursor yet (first
 * page) there is no WHERE clause; every later page filters on the keyset
 * cursor via a row-wise comparison, which also covers composite primary
 * keys (`(shelter_id, volunteer_id) > ($1, $2)`), not just single columns.
 */
export function buildSelectSql(
  config: TableImportConfig,
  hasCursor: boolean,
): string {
  const cols = config.columns.map((c) => selectColumnSql(config, c)).join(', ');
  const pkTuple = config.primaryKey.join(', ');

  if (!hasCursor) {
    return `SELECT ${cols} FROM ${config.table} ORDER BY ${pkTuple} ASC LIMIT $1`;
  }

  const cursorParams = config.primaryKey.map((_, i) => `$${i + 1}`).join(', ');
  const limitParam = `$${config.primaryKey.length + 1}`;
  const pkLhs =
    config.primaryKey.length === 1 ? config.primaryKey[0] : `(${pkTuple})`;
  const pkRhs =
    config.primaryKey.length === 1 ? cursorParams : `(${cursorParams})`;

  return `SELECT ${cols} FROM ${config.table} WHERE ${pkLhs} > ${pkRhs} ORDER BY ${pkTuple} ASC LIMIT ${limitParam}`;
}

/**
 * Builds the target-side batch INSERT for `rowCount` rows, explicit columns,
 * `ON CONFLICT (<primary key>) DO NOTHING` so re-running the import is a
 * no-op on rows already present.
 */
export function buildInsertSql(
  config: TableImportConfig,
  rowCount: number,
): string {
  const columnCount = config.columns.length;

  const valuesSql = Array.from({ length: rowCount }, (_, rowIdx) => {
    const placeholders = config.columns.map((col, colIdx) => {
      const paramIdx = rowIdx * columnCount + colIdx + 1;
      const cast = config.jsonColumns?.includes(col) ? '::jsonb' : '';
      return `$${paramIdx}${cast}`;
    });
    return `(${placeholders.join(', ')})`;
  }).join(', ');

  return [
    `INSERT INTO ${config.table} (${config.columns.join(', ')})`,
    `VALUES ${valuesSql}`,
    `ON CONFLICT (${config.primaryKey.join(', ')}) DO NOTHING`,
  ].join('\n');
}

/**
 * Flattens one mirror row (in `config.columns` order) into query params.
 *
 * Values are copied faithfully, with one known exception: `timestamp(6)`
 * columns (e.g. `created_at`/`updated_at`) round-trip through node-pg as JS
 * `Date` objects, which only carry millisecond precision. Any sub-millisecond
 * component the mirror stored is truncated on the way to the target. Both
 * schemas declare the same `timestamp(6)`, so this is a driver limitation,
 * not a schema mismatch -- see `docs/IMPORT.md`'s Open Items section. Not
 * worth fixing for this phase: it has zero effect on auth or business logic,
 * and a real cutover reimports with a delta pass anyway.
 */
export function rowToParams(
  config: TableImportConfig,
  row: Record<string, unknown>,
): unknown[] {
  return config.columns.map((c) => row[c] ?? null);
}

/** Extracts the next keyset cursor (one value per primary-key column) from the last row of a page, or `null` when the page was empty. */
export function nextCursor(
  config: TableImportConfig,
  rows: Record<string, unknown>[],
): unknown[] | null {
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return config.primaryKey.map((c) => last[c]);
}

/**
 * The four legacy WordPress tables whose primary key is `SERIAL`/`BIGSERIAL`
 * on the target. Explicit-id inserts never advance the sequence, so without
 * this the next non-imported insert collides with an id that already exists.
 */
export const LEGACY_SEQUENCE_TABLES: { table: string; pk: string }[] = [
  { table: 'wp_users_raw', pk: 'id' },
  { table: 'wp_posts_raw', pk: 'id' },
  { table: 'wp_postmeta_raw', pk: 'meta_id' },
  { table: 'wp_usermeta_raw', pk: 'umeta_id' },
];

export function buildSequenceResetSql(table: string, pk: string): string {
  return `SELECT setval(pg_get_serial_sequence('${table}', '${pk}'), COALESCE((SELECT MAX(${pk}) FROM ${table}), 1))`;
}

/**
 * Dependency order for every table imported by this task (users, Task 3,
 * always runs first and is not part of this list). `shelters` must be
 * imported with `trigger_shelter_history` disabled, and it must stay
 * disabled through `shelter_history` itself -- see index.ts, which reads
 * `SHELTER_TRIGGER_SPAN` to know where to wrap the disable/enable.
 */
export const TABLES: TableImportConfig[] = [
  {
    table: 'wp_users_raw',
    primaryKey: ['id'],
    columns: [
      'id',
      'user_login',
      'user_pass',
      'user_nicename',
      'user_email',
      'user_url',
      'user_registered',
      'user_activation_key',
      'user_status',
      'display_name',
    ],
  },
  {
    table: 'wp_users_legacy',
    primaryKey: ['id'],
    columns: [
      'id',
      'user_login',
      'user_email',
      'user_pass',
      'display_name',
      'migrated',
      'migrated_at',
      'created_at',
    ],
  },
  {
    table: 'wp_posts_raw',
    primaryKey: ['id'],
    columns: [
      'id',
      'post_author',
      'post_date',
      'post_date_gmt',
      'post_content',
      'post_title',
      'post_excerpt',
      'post_status',
      'comment_status',
      'ping_status',
      'post_password',
      'post_name',
      'to_ping',
      'pinged',
      'post_modified',
      'post_modified_gmt',
      'post_content_filtered',
      'post_parent',
      'guid',
      'menu_order',
      'post_type',
      'post_mime_type',
      'comment_count',
    ],
  },
  {
    table: 'wp_postmeta_raw',
    primaryKey: ['meta_id'],
    columns: ['meta_id', 'post_id', 'meta_key', 'meta_value'],
  },
  {
    table: 'wp_usermeta_raw',
    primaryKey: ['umeta_id'],
    columns: ['umeta_id', 'user_id', 'meta_key', 'meta_value'],
  },
  {
    table: 'shelters',
    primaryKey: ['id'],
    jsonColumns: ['additional_species'],
    columns: [
      'id',
      'wp_post_id',
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
      'additional_species',
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
      'created_at',
      'updated_at',
      'wp_post_author',
    ],
  },
  {
    table: 'volunteers',
    primaryKey: ['id'],
    columns: [
      'id',
      'wp_post_id',
      'owner_profile_id',
      'name',
      'telefone',
      'cidade',
      'estado',
      'profissao',
      'escolaridade',
      'faixa_etaria',
      'genero',
      'experiencia',
      'atuacao',
      'disponibilidade',
      'periodo',
      'descricao',
      'comentarios',
      'is_public',
      'created_at',
      'updated_at',
      'accept_terms',
      'slug',
      'referral_source',
    ],
  },
  {
    table: 'vacancies',
    primaryKey: ['id'],
    columns: [
      'id',
      'wp_post_id',
      'shelter_id',
      'shelter_name_raw',
      'title',
      'description',
      'cidade',
      'estado',
      'area_atuacao',
      'carga_horaria',
      'periodo',
      'habilidades_e_funcoes',
      'perfil_dos_voluntarios',
      'tipo_demanda',
      'inscritos',
      'status',
      'created_at',
      'updated_at',
      'slug',
      'quantidade',
      'is_published',
    ],
  },
  {
    table: 'vacancy_applications',
    primaryKey: ['id'],
    columns: [
      'id',
      'vacancy_id',
      'volunteer_id',
      'status',
      'applied_at',
      'created_at',
      'updated_at',
    ],
  },
  {
    table: 'shelter_dynamics',
    primaryKey: ['id'],
    columns: [
      'id',
      'shelter_id',
      'kind',
      'reference_date',
      'reference_period',
      'dynamic_type',
      'entradas_de_animais',
      'entradas_de_gatos',
      'adocoes_caes',
      'adocoes_gatos',
      'devolucoes_caes',
      'devolucoes_gatos',
      'eutanasias_caes',
      'eutanasias_gatos',
      'mortes_naturais_caes',
      'mortes_naturais_gatos',
      'doencas_caes',
      'doencas_gatos',
      'retorno_de_caes',
      'retorno_de_gatos',
      'retorno_local_caes',
      'retorno_local_gatos',
      'created_at',
      'updated_at',
    ],
  },
  {
    table: 'shelter_volunteers',
    primaryKey: ['shelter_id', 'volunteer_id'],
    columns: [
      'shelter_id',
      'volunteer_id',
      'role',
      'status',
      'created_at',
      'updated_at',
    ],
  },
  {
    table: 'shelter_history',
    primaryKey: ['id'],
    jsonColumns: ['old_data', 'new_data'],
    columns: [
      'id',
      'shelter_id',
      'profile_id',
      'operation',
      'old_data',
      'new_data',
      'changed_fields',
      'changed_at',
      'changed_by',
    ],
  },
  {
    table: 'team_memberships',
    primaryKey: ['id'],
    columns: [
      'id',
      'owner_profile_id',
      'owner_wp_user_id',
      'member_profile_id',
      'member_wp_user_id',
      'member_email',
      'abrigo_post_id',
      'role',
      'status',
      'created_at',
      'updated_at',
    ],
  },
  {
    table: 'deletion_flags',
    primaryKey: ['id'],
    columns: [
      'id',
      'table_name',
      'record_id',
      'flagged_at',
      'flagged_by',
      'reason',
      'deleted_at',
      'status',
    ],
  },
];

/**
 * `trigger_shelter_history` must be disabled starting right before
 * `shelters` and re-enabled only after `shelter_history` -- both tables are
 * populated directly in that span, and if the trigger stays on it fires a
 * fresh (bogus) history row for every inserted shelter, corrupting the 1025
 * real ones. Exported as the two table names (rather than indices) so
 * index.ts's `--only` handling stays correct even if TABLES is reordered.
 */
export const SHELTER_TRIGGER_SPAN = {
  from: 'shelters',
  to: 'shelter_history',
} as const;

export interface CopyResult {
  read: number;
  inserted: number;
  skipped: number;
}

export interface CopyTableOptions {
  dryRun?: boolean;
}

/**
 * Copies one table from mirror to target: batches of `config.batchSize`
 * (default 500) read via keyset pagination ordered by the primary key,
 * inserted with `ON CONFLICT DO NOTHING`.
 *
 * In dry-run mode nothing is written: each batch's primary keys are looked
 * up on the target (a read-only query) to report how many rows would be
 * inserted vs. would be skipped as already present, without ever issuing an
 * INSERT.
 */
export async function copyTable(
  mirror: Client,
  target: Client,
  config: TableImportConfig,
  options: CopyTableOptions = {},
): Promise<CopyResult> {
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const dryRun = options.dryRun ?? false;

  let cursor: unknown[] | null = null;
  let read = 0;
  let inserted = 0;
  let skipped = 0;

  for (;;) {
    const hasCursor = cursor !== null;
    const sql = buildSelectSql(config, hasCursor);
    const params = hasCursor
      ? [...(cursor as unknown[]), batchSize]
      : [batchSize];

    const { rows } = await mirror.query<Record<string, unknown>>(sql, params);
    if (rows.length === 0) break;

    read += rows.length;

    if (dryRun) {
      const existing = await countExistingByPk(target, config, rows);
      inserted += rows.length - existing;
      skipped += existing;
    } else {
      const insertSql = buildInsertSql(config, rows.length);
      const params2 = rows.flatMap((r) => rowToParams(config, r));
      const result = await target.query(insertSql, params2);
      const insertedNow = result.rowCount ?? 0;
      inserted += insertedNow;
      skipped += rows.length - insertedNow;
    }

    cursor = nextCursor(config, rows);
    if (rows.length < batchSize) break;
  }

  return { read, inserted, skipped };
}

/**
 * Dry-run helper: counts how many of `rows` already exist on the target by
 * primary key, so dry-run can report an accurate would-insert/would-skip
 * split without writing anything.
 */
async function countExistingByPk(
  target: Client,
  config: TableImportConfig,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (config.primaryKey.length === 1) {
    const pk = config.primaryKey[0];
    const ids = rows.map((r) => r[pk]);
    const { rows: existing } = await target.query(
      `SELECT ${pk} FROM ${config.table} WHERE ${pk} = ANY($1)`,
      [ids],
    );
    return existing.length;
  }

  // Composite primary key (only shelter_volunteers today): check row by row.
  let count = 0;
  for (const row of rows) {
    const conditions = config.primaryKey
      .map((c, i) => `${c} = $${i + 1}`)
      .join(' AND ');
    const params = config.primaryKey.map((c) => row[c]);
    const { rows: existing } = await target.query(
      `SELECT 1 FROM ${config.table} WHERE ${conditions} LIMIT 1`,
      params,
    );
    if (existing.length > 0) count += 1;
  }
  return count;
}
