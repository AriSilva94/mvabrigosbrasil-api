import { Client } from 'pg';

const DEFAULT_MIRROR_URL =
  'postgresql://mirror:mirror@localhost:5434/supabase_mirror';

/**
 * Opens a connected `pg.Client` to the disposable Supabase mirror
 * (see docker-compose.mirror.yml). The mirror is used by later
 * import-related scripts as the read source for data that used to
 * live in Supabase.
 */
export async function openMirror(): Promise<Client> {
  const connectionString =
    process.env.MIRROR_DATABASE_URL ?? DEFAULT_MIRROR_URL;

  const client = new Client({ connectionString });
  await client.connect();

  return client;
}
