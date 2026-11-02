import { Client } from 'pg';
import { syncSnapshot } from '../scripts/import/sync';
import { TABLES } from '../scripts/import/tables';

const userId = '10000000-0000-4000-8000-000000000001';
const teamId = '10000000-0000-4000-8000-000000000002';
const removedId = '10000000-0000-4000-8000-000000000003';
const shelterId = '20000000-0000-4000-8000-000000000001';
const removedShelterId = '20000000-0000-4000-8000-000000000002';
const hash = '$2b$04$TZeX7FW9htDIsF7IVPdLGeZVmk3lrSX2O3Mj/QYVyhzwcJrUsaZ2W';

describe('final snapshot synchronization (isolated PostgreSQL)', () => {
  let mirror: Client;
  let target: Client;
  const tables = ['users', ...TABLES.map((t) => t.table)];

  beforeAll(async () => {
    if (
      !process.env.SYNC_TEST_MIRROR_URL ||
      !process.env.SYNC_TEST_TARGET_URL
    ) {
      throw new Error(
        'Configure SYNC_TEST_MIRROR_URL e SYNC_TEST_TARGET_URL para bancos descartáveis *_sync_source e *_sync_target.',
      );
    }
    mirror = new Client({ connectionString: process.env.SYNC_TEST_MIRROR_URL });
    target = new Client({ connectionString: process.env.SYNC_TEST_TARGET_URL });
    await mirror.connect();
    await target.connect();
    for (const [client, suffix] of [
      [mirror, '_sync_source'],
      [target, '_sync_target'],
    ] as const) {
      const { rows } = await client.query<{ name: string }>(
        'SELECT current_database() AS name',
      );
      if (!rows[0].name.endsWith(suffix))
        throw new Error(`O banco de teste deve terminar em ${suffix}`);
    }
    await mirror.query(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE VIEW auth.users AS SELECT
        id, email, password_hash AS encrypted_password,
        CASE WHEN email_verified THEN created_at END AS email_confirmed_at,
        jsonb_build_object('registerType',role,'teamOnly',is_team_only,
          'teamDisabled',team_disabled,'creator_profile_id',creator_profile_id) AS raw_user_meta_data,
        created_at, updated_at, NULL::timestamptz AS deleted_at FROM public.users;
      CREATE OR REPLACE VIEW public.profiles AS SELECT
        id,full_name,phone,wp_user_id,origin,is_team_only FROM public.users;
    `);
  });

  afterAll(async () => {
    await mirror?.end();
    await target?.end();
  });

  beforeEach(async () => {
    for (const client of [mirror, target])
      await client.query(`TRUNCATE ${tables.join(', ')}`);
    await mirror.query(
      `INSERT INTO users (id,email,password_hash,role) VALUES ($1,'owner@test.local',$2,'abrigo')`,
      [userId, hash],
    );
    await mirror.query(
      `INSERT INTO users (id,email,password_hash,is_team_only,creator_profile_id) VALUES ($1,'team@test.local',$2,true,$3)`,
      [teamId, hash, userId],
    );
    await mirror.query(
      `INSERT INTO shelters (id,name,wp_post_id,profile_id) VALUES ($1,'Updated shelter',100,$2)`,
      [shelterId, userId],
    );
    await mirror.query(
      `INSERT INTO wp_users_legacy (id,user_login,user_email,user_pass,migrated) VALUES (42,'owner','owner@test.local','legacy-hash',true)`,
    );
    await target.query(
      `INSERT INTO users (id,email,password_hash) VALUES ($1,'owner@test.local','outdated'),($2,'removed@test.local','removed')`,
      [userId, removedId],
    );
    await target.query(
      `INSERT INTO shelters (id,name,wp_post_id,profile_id) VALUES ($1,'Old shelter',100,$2),($3,'Removed shelter',101,$4)`,
      [shelterId, userId, removedShelterId, removedId],
    );
    await target.query(
      `INSERT INTO wp_users_legacy (id,user_login,user_email,user_pass,migrated) VALUES (42,'owner','owner@test.local','old-legacy-hash',false)`,
    );
  });

  it('previews inserts, updates and deletions without changing target data or triggers', async () => {
    const report = await syncSnapshot(mirror, target);
    expect(report.users).toMatchObject({
      inserted: 1,
      updated: 1,
      deleted: 1,
      unchanged: 0,
    });
    expect(report.shelters).toMatchObject({ updated: 1, deleted: 1 });
    expect(
      (
        await target.query<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id=$1',
          [userId],
        )
      ).rows[0].password_hash,
    ).toBe('outdated');
    expect(
      (
        await target.query<{ migrated: boolean }>(
          'SELECT migrated FROM wp_users_legacy WHERE id=42',
        )
      ).rows[0].migrated,
    ).toBe(false);
  });

  it('synchronizes hashes, flags, additions, removals and creator links; rerunning is idempotent', async () => {
    await syncSnapshot(mirror, target, { apply: true });
    expect(
      (
        await target.query<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id=$1',
          [userId],
        )
      ).rows[0].password_hash,
    ).toBe(hash);
    expect(
      (
        await target.query<{ creator_profile_id: string }>(
          'SELECT creator_profile_id FROM users WHERE id=$1',
          [teamId],
        )
      ).rows[0].creator_profile_id,
    ).toBe(userId);
    expect(
      (await target.query('SELECT id FROM users WHERE id=$1', [removedId]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await target.query<{ migrated: boolean }>(
          'SELECT migrated FROM wp_users_legacy WHERE id=42',
        )
      ).rows[0].migrated,
    ).toBe(true);
    const report = await syncSnapshot(mirror, target, { apply: true });
    for (const row of Object.values(report))
      expect(row).toMatchObject({ inserted: 0, updated: 0, deleted: 0 });
    expect(
      (await target.query('SELECT id FROM shelter_history')).rowCount,
    ).toBe((await mirror.query('SELECT id FROM shelter_history')).rowCount);
    const { rows } = await target.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname='trigger_shelter_history'",
    );
    expect(rows[0].tgenabled).toBe('O');
  });

  it('handles reassigned unique emails in a complete snapshot', async () => {
    await target.query('UPDATE users SET email=$1 WHERE id=$2', [
      'team@test.local',
      userId,
    ]);
    await target.query(
      `INSERT INTO users (id,email,password_hash) VALUES ($1,'owner@test.local','old')`,
      [teamId],
    );
    await syncSnapshot(mirror, target, { apply: true });
    expect(
      (
        await target.query<{ email: string }>(
          'SELECT email FROM users WHERE id=$1',
          [userId],
        )
      ).rows[0].email,
    ).toBe('owner@test.local');
  });

  it('rolls back the whole destination and restores the audit trigger on a foreign key failure', async () => {
    await mirror.query(`SET session_replication_role=replica`);
    try {
      await mirror.query('UPDATE shelters SET profile_id=$1 WHERE id=$2', [
        removedId,
        shelterId,
      ]);
    } finally {
      await mirror.query('SET session_replication_role=origin');
    }
    await expect(
      syncSnapshot(mirror, target, { apply: true }),
    ).rejects.toThrow();
    expect(
      (
        await target.query<{ password_hash: string }>(
          'SELECT password_hash FROM users WHERE id=$1',
          [userId],
        )
      ).rows[0].password_hash,
    ).toBe('outdated');
    expect(
      (await target.query('SELECT id FROM users WHERE id=$1', [removedId]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await target.query<{ tgenabled: string }>(
          "SELECT tgenabled FROM pg_trigger WHERE tgname='trigger_shelter_history'",
        )
      ).rows[0].tgenabled,
    ).toBe('O');
  });

  it('rejects identical source and destination databases', async () => {
    await expect(syncSnapshot(target, target, { apply: true })).rejects.toThrow(
      /origem.*destino/i,
    );
  });

  it('preserves microseconds in user and domain timestamps', async () => {
    await mirror.query(
      "UPDATE users SET created_at='2026-01-01 12:00:00.123456+00' WHERE id=$1",
      [userId],
    );
    await mirror.query(
      "UPDATE shelters SET created_at='2026-01-01 12:00:00.654321+00' WHERE id=$1",
      [shelterId],
    );
    await syncSnapshot(mirror, target, { apply: true });
    for (const [table, id] of [
      ['users', userId],
      ['shelters', shelterId],
    ]) {
      const sql = `SELECT created_at::text AS stamp FROM ${table} WHERE id=$1`;
      expect(
        (await target.query<{ stamp: string }>(sql, [id])).rows[0].stamp,
      ).toBe((await mirror.query<{ stamp: string }>(sql, [id])).rows[0].stamp);
    }
  });

  it('rolls back sequence restarts when commit fails after the data was verified', async () => {
    await target.query(
      "SELECT setval(pg_get_serial_sequence('wp_users_raw','id'),1000)",
    );
    await target.query(`
      CREATE FUNCTION pg_temp.fail_sync_commit() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'synthetic commit failure'; END $$;
      CREATE CONSTRAINT TRIGGER fail_sync_commit AFTER INSERT ON users
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_sync_commit();
    `);
    try {
      await expect(
        syncSnapshot(mirror, target, { apply: true }),
      ).rejects.toThrow('synthetic commit failure');
      const result = await target.query<{ last_value: string }>(
        'SELECT last_value FROM wp_users_raw_id_seq',
      );
      expect(String(result.rows[0].last_value)).toBe('1000');
      expect(
        (
          await target.query<{ password_hash: string }>(
            'SELECT password_hash FROM users WHERE id=$1',
            [userId],
          )
        ).rows[0].password_hash,
      ).toBe('outdated');
    } finally {
      await target.query('DROP TRIGGER fail_sync_commit ON users');
      await target.query('DROP FUNCTION pg_temp.fail_sync_commit()');
    }
  });

  it('also rejects two connections pointing to the same physical database', async () => {
    const other = new Client({
      connectionString: process.env.SYNC_TEST_TARGET_URL,
    });
    await other.connect();
    try {
      await expect(
        syncSnapshot(other, target, { apply: true }),
      ).rejects.toThrow(/origem.*destino/i);
    } finally {
      await other.end();
    }
  });

  it('refuses an empty source without wiping existing destination data', async () => {
    await mirror.query(`TRUNCATE ${tables.join(', ')}`);
    await expect(syncSnapshot(mirror, target, { apply: true })).rejects.toThrow(
      /não contém usuários/,
    );
    expect(
      (await target.query('SELECT id FROM users WHERE id=$1', [userId]))
        .rowCount,
    ).toBe(1);
  });

  it('refuses to apply when the audit trigger is already disabled', async () => {
    await target.query(
      'ALTER TABLE shelters DISABLE TRIGGER trigger_shelter_history',
    );
    try {
      await expect(
        syncSnapshot(mirror, target, { apply: true }),
      ).rejects.toThrow(/histórico.*ativo/);
      expect(
        (
          await target.query<{ tgenabled: string }>(
            "SELECT tgenabled FROM pg_trigger WHERE tgname='trigger_shelter_history'",
          )
        ).rows[0].tgenabled,
      ).toBe('D');
    } finally {
      await target.query(
        'ALTER TABLE shelters ENABLE TRIGGER trigger_shelter_history',
      );
    }
  });
});
