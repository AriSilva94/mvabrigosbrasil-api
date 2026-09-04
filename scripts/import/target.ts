import { Client } from 'pg';

const DEFAULT_TARGET_URL = 'postgresql://mv:mv@localhost:5433/mvabrigos';

/**
 * Opens a connected `pg.Client` to the target NestJS database (mv-pg,
 * host port 5433), the destination of every import script. Reuses
 * `DATABASE_URL` when set (same variable the app itself uses) so import
 * scripts and the running app never disagree about which database is "the
 * target".
 */
export async function openTarget(): Promise<Client> {
  const connectionString = process.env.DATABASE_URL ?? DEFAULT_TARGET_URL;

  const client = new Client({ connectionString });
  await client.connect();

  return client;
}
