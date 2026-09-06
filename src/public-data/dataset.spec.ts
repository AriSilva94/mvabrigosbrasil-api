import {
  buildDatabaseDataset,
  parseMetaNumber,
  parseMonth,
  parseYear,
} from './dataset';

describe('database dataset mapping', () => {
  it.each([
    ['2024-05-20T12:30:00.000Z', 2024, 5],
    ['2023-11-09 10:20:30', 2023, 11],
    ['invalid', 0, 1],
    [null, 0, 1],
  ])('parses year and month from %p', (value, year, month) => {
    expect(parseYear(value)).toBe(year);
    expect(parseMonth(value)).toBe(month);
  });

  it.each([
    ['12,5', 12.5],
    [' 7.25 ', 7.25],
    ['invalid', 0],
    [null, 0],
  ])('normalizes metric %p to %p', (value, expected) => {
    expect(parseMetaNumber(value)).toBe(expected);
  });

  it('preserves the frontend dataset shapes, lookup, hash, years and states', () => {
    const shelterRows = [
      {
        id: 'shelter-a',
        wpPostId: 42,
        name: 'Abrigo A',
        state: ' rs ',
        shelterType: 'temporary',
        foundationDate: new Date('2010-01-01T00:00:00.000Z'),
        createdAt: new Date('2024-02-03T04:05:06.000Z'),
      },
      {
        id: 'shelter-b',
        wpPostId: null,
        name: 'Abrigo B',
        state: 'SP',
        shelterType: 'private',
        foundationDate: null,
        createdAt: new Date('2022-08-01T00:00:00.000Z'),
      },
    ];
    const dynamicsRows = [
      {
        id: 'dynamic-a',
        shelterId: 'shelter-a',
        kind: 'lar',
        dynamicType: 'dinamica_lar',
        referenceDate: new Date('2024-03-01T00:00:00.000Z'),
        referencePeriod: '2024-03',
        entradasDeAnimais: 10,
        entradasDeGatos: 2,
        adocoesCaes: 3,
        adocoesGatos: 1,
        devolucoesCaes: 4,
        devolucoesGatos: 2,
        eutanasiasCaes: 0,
        eutanasiasGatos: 1,
        mortesNaturaisCaes: 2,
        mortesNaturaisGatos: 3,
        retornoDeCaes: 5,
        retornoDeGatos: 6,
        retornoLocalCaes: 7,
        retornoLocalGatos: 8,
      },
    ];

    const result = buildDatabaseDataset(shelterRows, dynamicsRows);

    expect(result.shelters).toEqual([
      {
        id: 42,
        title: 'Abrigo A',
        postDate: '2024-02-03T04:05:06.000Z',
        year: 2024,
        month: 2,
        state: 'RS',
        type: 'LT-PI',
      },
      {
        id: 0,
        title: 'Abrigo B',
        postDate: '2022-08-01T00:00:00.000Z',
        year: 2022,
        month: 8,
        state: 'SP',
        type: 'Privado',
      },
    ]);
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).toMatchObject({
      postType: 'dinamica_lar',
      year: 2024,
      month: 3,
      shelterId: 42,
      shelterState: 'RS',
      shelterType: 'LT-PI',
      metrics: {
        entradas: 10,
        entradasGatos: 2,
        adocoes: 3,
        adocoesGatos: 1,
        devolucoes: 4,
        devolucoesGatos: 2,
        eutanasias: 0,
        eutanasiasGatos: 1,
        mortesNaturais: 2,
        mortesNaturaisGatos: 3,
        retornoTutor: 11,
        retornoTutorGatos: 6,
        retornoLocal: 15,
        retornoLocalGatos: 8,
      },
    });
    expect(result.movements[0]?.id).toEqual(expect.any(Number));
    expect(result.years).toEqual([2024, 2022]);
    expect(result.states).toEqual(['RS', 'SP']);
  });
});
