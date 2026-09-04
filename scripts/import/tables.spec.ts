import {
  buildInsertSql,
  buildSelectSql,
  buildSequenceResetSql,
  LEGACY_SEQUENCE_TABLES,
  nextCursor,
  rowToParams,
  SHELTER_TRIGGER_SPAN,
  TABLES,
  type TableImportConfig,
} from './tables';

/**
 * All configs/rows below are SYNTHETIC — just enough shape to exercise the
 * pure SQL-building helpers. No live DB involved.
 */
const simpleConfig: TableImportConfig = {
  table: 'widgets',
  primaryKey: ['id'],
  columns: ['id', 'name', 'created_at'],
};

const jsonConfig: TableImportConfig = {
  table: 'shelters',
  primaryKey: ['id'],
  jsonColumns: ['additional_species'],
  columns: ['id', 'name', 'additional_species'],
};

const compositeConfig: TableImportConfig = {
  table: 'shelter_volunteers',
  primaryKey: ['shelter_id', 'volunteer_id'],
  columns: ['shelter_id', 'volunteer_id', 'role'],
};

describe('buildSelectSql', () => {
  it('first page has no WHERE clause and a single LIMIT param', () => {
    const sql = buildSelectSql(simpleConfig, false);
    expect(sql).not.toMatch(/WHERE/);
    expect(sql).toContain('ORDER BY id ASC LIMIT $1');
    expect(sql).toContain('SELECT id, name, created_at FROM widgets');
  });

  it('subsequent pages filter on the keyset cursor and use $2 for LIMIT', () => {
    const sql = buildSelectSql(simpleConfig, true);
    expect(sql).toContain('WHERE id > $1');
    expect(sql).toContain('LIMIT $2');
  });

  it('casts jsonb columns to text on read', () => {
    const sql = buildSelectSql(jsonConfig, false);
    expect(sql).toContain('additional_species::text');
    expect(sql).not.toMatch(/,\s*additional_species\s*FROM/); // never selected raw
  });

  it('uses a row-wise comparison for composite primary keys', () => {
    const sql = buildSelectSql(compositeConfig, true);
    expect(sql).toContain('WHERE (shelter_id, volunteer_id) > ($1, $2)');
    expect(sql).toContain('LIMIT $3');
    expect(sql).toContain('ORDER BY shelter_id, volunteer_id ASC');
  });
});

describe('buildInsertSql', () => {
  it('builds one placeholder tuple per row and ON CONFLICT on the primary key', () => {
    const sql = buildInsertSql(simpleConfig, 2);
    expect(sql).toContain('INSERT INTO widgets (id, name, created_at)');
    expect(sql).toContain('($1, $2, $3), ($4, $5, $6)');
    expect(sql).toContain('ON CONFLICT (id) DO NOTHING');
  });

  it('casts jsonb placeholders with ::jsonb', () => {
    const sql = buildInsertSql(jsonConfig, 1);
    expect(sql).toContain('($1, $2, $3::jsonb)');
  });

  it('conflicts on every composite-key column', () => {
    const sql = buildInsertSql(compositeConfig, 1);
    expect(sql).toContain('ON CONFLICT (shelter_id, volunteer_id) DO NOTHING');
  });

  it('produces zero value tuples (but still valid column list) for an empty batch', () => {
    const sql = buildInsertSql(simpleConfig, 0);
    expect(sql).toContain('VALUES ');
    expect(sql).not.toContain('($1');
  });
});

describe('rowToParams', () => {
  it('flattens a row in column order, defaulting missing fields to null', () => {
    const params = rowToParams(simpleConfig, { id: 1, name: 'Foo' });
    expect(params).toEqual([1, 'Foo', null]);
  });

  it('does not coerce falsy-but-defined values to null', () => {
    const params = rowToParams(simpleConfig, {
      id: 0,
      name: '',
      created_at: null,
    });
    expect(params).toEqual([0, '', null]);
  });
});

describe('nextCursor', () => {
  it('returns null for an empty page', () => {
    expect(nextCursor(simpleConfig, [])).toBeNull();
  });

  it('returns the primary-key value(s) of the last row', () => {
    const rows = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ];
    expect(nextCursor(simpleConfig, rows)).toEqual([2]);
  });

  it('returns a tuple for composite primary keys', () => {
    const rows = [{ shelter_id: 's1', volunteer_id: 'v1', role: 'x' }];
    expect(nextCursor(compositeConfig, rows)).toEqual(['s1', 'v1']);
  });
});

describe('buildSequenceResetSql', () => {
  it('resets the sequence to MAX(pk), falling back to 1 on an empty table', () => {
    const sql = buildSequenceResetSql('wp_posts_raw', 'id');
    expect(sql).toBe(
      "SELECT setval(pg_get_serial_sequence('wp_posts_raw', 'id'), COALESCE((SELECT MAX(id) FROM wp_posts_raw), 1))",
    );
  });

  it('is generated for exactly the four legacy autoincrement tables', () => {
    expect(LEGACY_SEQUENCE_TABLES.map((t) => t.table).sort()).toEqual(
      [
        'wp_postmeta_raw',
        'wp_posts_raw',
        'wp_users_raw',
        'wp_usermeta_raw',
      ].sort(),
    );
  });
});

describe('TABLES (dependency order)', () => {
  it('lists every remaining table exactly once, in the brief-mandated order', () => {
    expect(TABLES.map((t) => t.table)).toEqual([
      'wp_users_raw',
      'wp_users_legacy',
      'wp_posts_raw',
      'wp_postmeta_raw',
      'wp_usermeta_raw',
      'shelters',
      'volunteers',
      'vacancies',
      'vacancy_applications',
      'shelter_dynamics',
      'shelter_volunteers',
      'shelter_history',
      'team_memberships',
      'deletion_flags',
    ]);
  });

  it('every column list includes the primary key column(s)', () => {
    for (const config of TABLES) {
      for (const pk of config.primaryKey) {
        expect(config.columns).toContain(pk);
      }
    }
  });

  it('shelters comes before shelter_history (audit-trigger span requirement)', () => {
    const shelterIdx = TABLES.findIndex((t) => t.table === 'shelters');
    const historyIdx = TABLES.findIndex((t) => t.table === 'shelter_history');
    expect(shelterIdx).toBeGreaterThanOrEqual(0);
    expect(historyIdx).toBeGreaterThan(shelterIdx);
  });

  it('SHELTER_TRIGGER_SPAN matches the actual table names in TABLES', () => {
    expect(TABLES.some((t) => t.table === SHELTER_TRIGGER_SPAN.from)).toBe(
      true,
    );
    expect(TABLES.some((t) => t.table === SHELTER_TRIGGER_SPAN.to)).toBe(true);
  });

  it('shelters copies initial_dogs/initial_cats verbatim — no sanitizing transform exists on TableImportConfig, and production has no CHECK on either column', () => {
    const shelters = TABLES.find((t) => t.table === 'shelters')!;
    expect(shelters.columns).toEqual(
      expect.arrayContaining(['initial_dogs', 'initial_cats']),
    );
  });
});
