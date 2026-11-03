import { Prisma } from '../../generated/prisma/client';
import type { WpUserLegacy } from '../../generated/prisma/client';

type LegacyReader = {
  $queryRaw: Prisma.TransactionClient['$queryRaw'];
  wpUserLegacy: Pick<Prisma.TransactionClient['wpUserLegacy'], 'findMany'>;
};

// `mode: 'insensitive'` vira `ILIKE` sem escape no Prisma: `%`/`_` no e-mail
// casavam com outras contas. A igualdade em `lower()` também usa o índice
// `idx_wp_users_legacy_email` em vez de seq scan.
export async function findLegacyByEmail(
  db: LegacyReader,
  email: string,
  options: { pendingOnly?: boolean } = {},
): Promise<WpUserLegacy[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  const rows = await db.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM wp_users_legacy
    WHERE lower(user_email) = ${normalized}
    ${options.pendingOnly ? Prisma.sql`AND migrated = false` : Prisma.empty}
    ORDER BY id
  `;
  if (rows.length === 0) return [];

  return db.wpUserLegacy.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    orderBy: { id: 'asc' },
  });
}
