import { isForeignKeyViolation, isUniqueViolation } from './prisma-error';

describe('prisma error codes', () => {
  it('detects unique violations from Prisma or a nested Postgres cause', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(
      isUniqueViolation({ cause: { originalError: { code: '23505' } } }),
    ).toBe(true);
    expect(isUniqueViolation({ code: 'P2003' })).toBe(false);
  });

  it('detects foreign key violations and ignores non-objects and cycles', () => {
    const cyclic: Record<string, unknown> = { code: 'X' };
    cyclic.cause = cyclic;
    expect(isForeignKeyViolation({ cause: { code: '23503' } })).toBe(true);
    expect(isForeignKeyViolation('boom')).toBe(false);
    expect(isForeignKeyViolation(cyclic)).toBe(false);
  });
});
