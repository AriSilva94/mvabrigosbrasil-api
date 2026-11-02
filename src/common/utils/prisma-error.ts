// Com o driver adapter do pg o código pode vir no erro do Prisma (P2002) ou
// só no erro original do Postgres (23505), aninhado em `cause`.
export function hasErrorCode(error: unknown, ...expected: string[]): boolean {
  const seen = new Set<object>();
  let current: unknown = error;

  while (
    typeof current === 'object' &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (typeof record.code === 'string' && expected.includes(record.code)) {
      return true;
    }
    current = record.cause ?? record.originalError;
  }

  return false;
}

export const isUniqueViolation = (error: unknown): boolean =>
  hasErrorCode(error, 'P2002', '23505');

export const isForeignKeyViolation = (error: unknown): boolean =>
  hasErrorCode(error, 'P2003', '23503');
