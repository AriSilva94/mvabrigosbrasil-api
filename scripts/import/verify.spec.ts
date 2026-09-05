import { compareRows, diffCounts, SHELTER_SAMPLE_COLUMNS } from './verify';

/**
 * All data below is SYNTHETIC — just enough shape to exercise the pure
 * comparison helpers. No live DB involved.
 */

describe('diffCounts', () => {
  it('produces a passing check for a table whose expected and actual counts match', () => {
    const checks = diffCounts({ widgets: { expected: 42, actual: 42 } });
    expect(checks).toEqual([
      { group: 'counts', name: 'widgets', ok: true, details: '42 rows' },
    ]);
  });

  it('produces a failing check with both numbers when counts diverge', () => {
    const checks = diffCounts({ widgets: { expected: 42, actual: 40 } });
    expect(checks).toHaveLength(1);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].details).toContain('expected 42');
    expect(checks[0].details).toContain('got 40');
  });

  it('reports one check per table, independently', () => {
    const checks = diffCounts({
      widgets: { expected: 10, actual: 10 },
      gadgets: { expected: 5, actual: 3 },
    });
    expect(checks).toHaveLength(2);
    expect(checks.find((c) => c.name === 'widgets')!.ok).toBe(true);
    expect(checks.find((c) => c.name === 'gadgets')!.ok).toBe(false);
  });

  it('returns an empty array for an empty input map', () => {
    expect(diffCounts({})).toEqual([]);
  });
});

describe('compareRows', () => {
  it('returns null when every compared column matches', () => {
    const mirror = {
      name: 'Abrigo Synthetic',
      city: 'Testville',
      active: true,
    };
    const target = {
      name: 'Abrigo Synthetic',
      city: 'Testville',
      active: true,
    };
    expect(compareRows(mirror, target, ['name', 'city', 'active'])).toBeNull();
  });

  it('reports the first mismatching column, stopping there', () => {
    const mirror = { name: 'A', city: 'X', active: true };
    const target = { name: 'B', city: 'Y', active: true };
    const result = compareRows(mirror, target, ['name', 'city', 'active']);
    expect(result).toEqual({
      column: 'name',
      mirrorValue: 'A',
      targetValue: 'B',
    });
  });

  it('skips matching leading columns and reports the later mismatch', () => {
    const mirror = { name: 'A', city: 'X' };
    const target = { name: 'A', city: 'Y' };
    const result = compareRows(mirror, target, ['name', 'city']);
    expect(result).toEqual({
      column: 'city',
      mirrorValue: 'X',
      targetValue: 'Y',
    });
  });

  it('treats null and undefined as equivalent "absent" values', () => {
    const mirror = { website: null };
    const target = { website: undefined };
    expect(compareRows(mirror, target, ['website'])).toBeNull();
  });

  it('treats a Date and its equivalent ISO string as equal', () => {
    const mirror = { foundation_date: new Date('2020-01-01T00:00:00.000Z') };
    const target = { foundation_date: '2020-01-01T00:00:00.000Z' };
    expect(compareRows(mirror, target, ['foundation_date'])).toBeNull();
  });

  it('stringifies numbers so 0 and "0" compare equal (driver representation differences)', () => {
    const mirror = { initial_dogs: 0 };
    const target = { initial_dogs: '0' };
    expect(compareRows(mirror, target, ['initial_dogs'])).toBeNull();
  });

  it('does not treat null and a real value as equal', () => {
    const mirror = { cnpj: null };
    const target = { cnpj: '12.345.678/0001-99' };
    const result = compareRows(mirror, target, ['cnpj']);
    expect(result).toEqual({
      column: 'cnpj',
      mirrorValue: null,
      targetValue: '12.345.678/0001-99',
    });
  });

  it('compares every column in SHELTER_SAMPLE_COLUMNS without throwing on missing keys', () => {
    expect(() => compareRows({}, {}, SHELTER_SAMPLE_COLUMNS)).not.toThrow();
    expect(compareRows({}, {}, SHELTER_SAMPLE_COLUMNS)).toBeNull();
  });
});
