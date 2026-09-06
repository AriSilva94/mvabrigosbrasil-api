import {
  buildDisplay,
  buildPopulationSummary,
  computeBalance,
  computeRates,
  deriveDynamicType,
  mapRecordToRow,
  parseReferenceLabel,
  type DynamicsRecord,
  type DynamicsTableRow,
} from './calc';

const metrics = {
  entriesDogs: 10,
  entriesCats: 5,
  returnsDogs: 2,
  returnsCats: 1,
  adoptionsDogs: 3,
  adoptionsCats: 2,
  euthanasiasDogs: 1,
  euthanasiasCats: 1,
  naturalDeathsDogs: 1,
  naturalDeathsCats: 0,
  diseasesDogs: 8,
  diseasesCats: 4,
  tutorReturnDogs: 1,
  tutorReturnCats: 1,
  originReturnDogs: 1,
  originReturnCats: 1,
};

const row: DynamicsTableRow = {
  id: 'record-1',
  referenceLabel: 'mar/2026',
  referenceDate: '2026-03-01',
  metrics,
  balance: 6,
  cumulativeBalance: null,
};

const record: DynamicsRecord = {
  id: 'record-1',
  shelterId: 'shelter-1',
  dynamicType: 'dinamica',
  referencePeriod: '2026-03',
  referenceDate: new Date('2026-03-01T00:00:00.000Z'),
  kind: 'abrigo',
  entradasDeAnimais: 10,
  entradasDeGatos: 5,
  adocoesCaes: 3,
  adocoesGatos: 2,
  devolucoesCaes: 2,
  devolucoesGatos: 1,
  eutanasiasCaes: 1,
  eutanasiasGatos: 1,
  mortesNaturaisCaes: 1,
  mortesNaturaisGatos: 0,
  doencasCaes: 8,
  doencasGatos: 4,
  retornoDeCaes: 1,
  retornoDeGatos: 1,
  retornoLocalCaes: 1,
  retornoLocalGatos: 1,
};

describe('dynamics calculations', () => {
  it('formats year-first and month-first reference periods', () => {
    expect(parseReferenceLabel('2026-03')).toBe('mar/2026');
    expect(parseReferenceLabel('04/2025')).toBe('abr/2025');
    expect(parseReferenceLabel(null)).toBe('—');
  });

  it('computes entries minus every population exit', () => {
    expect(computeBalance(metrics)).toBe(6);
  });

  it('computes entry, exit, adoption, mortality and morbidity rates', () => {
    expect(computeRates([row], 20)).toEqual([
      { key: 'entry', label: 'Taxa de Entrada', value: 90, trend: 'up' },
      { key: 'exit', label: 'Taxa de Saída', value: 60, trend: 'down' },
      { key: 'adoption', label: 'Taxa de Adoção', value: 25, trend: 'up' },
      {
        key: 'mortality',
        label: 'Taxa de Mortalidade',
        value: 15,
        trend: 'down',
      },
      {
        key: 'morbidity',
        label: 'Taxa de Morbidade',
        value: 60,
        trend: 'neutral',
      },
    ]);
  });

  it('returns null for every rate when populationInitial is zero', () => {
    expect(computeRates([row], 0).map(({ value }) => value)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('derives the dynamic type from kind before the legacy dynamicType', () => {
    expect(
      deriveDynamicType({ ...record, kind: 'lar', dynamicType: 'dinamica' }),
    ).toBe('dinamica_lar');
    expect(
      deriveDynamicType({
        ...record,
        kind: 'legacy',
        dynamicType: 'dinamica_lar',
      }),
    ).toBe('dinamica_lar');
    expect(
      deriveDynamicType({ ...record, kind: 'legacy', dynamicType: null }),
    ).toBe('dinamica');
  });

  it('maps every persisted metric and emits referenceDate as date-only', () => {
    expect(mapRecordToRow(record)).toEqual(row);
  });

  it('builds sorted rows, cumulative balance and current species populations', () => {
    const display = buildDisplay(
      [
        {
          ...record,
          id: 'record-2',
          referencePeriod: '2026-04',
          referenceDate: new Date('2026-04-01T00:00:00.000Z'),
        },
        record,
        { ...record, id: 'lar-1', kind: 'lar', dynamicType: 'dinamica_lar' },
      ],
      'dinamica',
      20,
      99,
      12,
      8,
    );

    expect(display).toMatchObject({
      dynamicType: 'dinamica',
      title: 'Dinâmica Populacional',
      populationInitial: 20,
      populationCurrent: 32,
      populationInitialDogs: 12,
      populationInitialCats: 8,
      populationCurrentDogs: 22,
      populationCurrentCats: 10,
    });
    expect(
      display.rows.map(({ id, cumulativeBalance }) => ({
        id,
        cumulativeBalance,
      })),
    ).toEqual([
      { id: 'record-1', cumulativeBalance: 26 },
      { id: 'record-2', cumulativeBalance: 32 },
    ]);
  });

  it('only totals initial populations when both dogs and cats are numbers', () => {
    expect(
      buildPopulationSummary({
        initialDogs: 4,
        initialCats: null,
        initialDogsLt: 2,
        initialCatsLt: 3,
      }),
    ).toEqual({
      shelterPopulationInitial: null,
      shelterPopulationInitialDogs: 4,
      shelterPopulationInitialCats: null,
      ltPopulationInitial: 5,
      ltPopulationInitialDogs: 2,
      ltPopulationInitialCats: 3,
    });
  });
});
