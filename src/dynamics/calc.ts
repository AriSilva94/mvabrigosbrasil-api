export type DynamicsMetrics = {
  entriesDogs: number | null;
  entriesCats: number | null;
  returnsDogs: number | null;
  returnsCats: number | null;
  adoptionsDogs: number | null;
  adoptionsCats: number | null;
  euthanasiasDogs: number | null;
  euthanasiasCats: number | null;
  naturalDeathsDogs: number | null;
  naturalDeathsCats: number | null;
  diseasesDogs: number | null;
  diseasesCats: number | null;
  tutorReturnDogs: number | null;
  tutorReturnCats: number | null;
  originReturnDogs: number | null;
  originReturnCats: number | null;
};

export type DynamicType = 'dinamica' | 'dinamica_lar';

export type DynamicsTableRow = {
  id: string;
  referenceLabel: string;
  referenceDate?: string | null;
  metrics: DynamicsMetrics;
  balance: number | null;
  cumulativeBalance: number | null;
};

export type RateCardData = {
  key: 'entry' | 'exit' | 'adoption' | 'mortality' | 'morbidity';
  label: string;
  value: number | null;
  trend: 'up' | 'down' | 'neutral';
  helperText?: string | null;
};

export type DynamicsRecord = {
  id: string;
  shelterId: string;
  dynamicType: string | null;
  referencePeriod: string | null;
  referenceDate: Date | null;
  kind: string;
  entradasDeAnimais: number | null;
  entradasDeGatos: number | null;
  adocoesCaes: number | null;
  adocoesGatos: number | null;
  devolucoesCaes: number | null;
  devolucoesGatos: number | null;
  eutanasiasCaes: number | null;
  eutanasiasGatos: number | null;
  mortesNaturaisCaes: number | null;
  mortesNaturaisGatos: number | null;
  doencasCaes: number | null;
  doencasGatos: number | null;
  retornoDeCaes: number | null;
  retornoDeGatos: number | null;
  retornoLocalCaes: number | null;
  retornoLocalGatos: number | null;
};

export type DynamicsDisplay = {
  dynamicType: DynamicType;
  title: string;
  populationInitial: number | null;
  populationCurrent: number | null;
  populationInitialDogs?: number | null;
  populationInitialCats?: number | null;
  populationCurrentDogs?: number | null;
  populationCurrentCats?: number | null;
  stats: RateCardData[];
  rows: DynamicsTableRow[];
};

export type PopulationSummaryValues = {
  shelterPopulationInitial: number | null;
  shelterPopulationInitialDogs: number | null;
  shelterPopulationInitialCats: number | null;
  ltPopulationInitial: number | null;
  ltPopulationInitialDogs: number | null;
  ltPopulationInitialCats: number | null;
};

export const MONTH_LABELS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

export function parseReferenceLabel(reference: string | null): string {
  if (!reference) return '—';
  const cleaned = reference.replace('/', '-');
  const [part1, part2] = cleaned.split('-');
  const hasYearFirst = part1.length === 4;
  const year = hasYearFirst ? part1 : part2;
  const month = hasYearFirst ? part2 : part1;
  const monthIndex = Number.parseInt(month, 10) - 1;
  const monthLabel = MONTH_LABELS[monthIndex] ?? month;
  return `${monthLabel}/${year}`;
}

export function computeBalance(metrics: DynamicsMetrics): number {
  const entries =
    (metrics.entriesDogs ?? 0) +
    (metrics.entriesCats ?? 0) +
    (metrics.returnsDogs ?? 0) +
    (metrics.returnsCats ?? 0);
  const exits =
    (metrics.adoptionsDogs ?? 0) +
    (metrics.adoptionsCats ?? 0) +
    (metrics.tutorReturnDogs ?? 0) +
    (metrics.tutorReturnCats ?? 0) +
    (metrics.originReturnDogs ?? 0) +
    (metrics.originReturnCats ?? 0) +
    (metrics.euthanasiasDogs ?? 0) +
    (metrics.euthanasiasCats ?? 0) +
    (metrics.naturalDeathsDogs ?? 0) +
    (metrics.naturalDeathsCats ?? 0);
  return entries - exits;
}

export function computeRates(
  rows: DynamicsTableRow[],
  populationInitial: number | null,
): RateCardData[] {
  if (!populationInitial || populationInitial <= 0) {
    return [
      { key: 'entry', label: 'Taxa de Entrada', value: null, trend: 'neutral' },
      { key: 'exit', label: 'Taxa de Saída', value: null, trend: 'neutral' },
      {
        key: 'adoption',
        label: 'Taxa de Adoção',
        value: null,
        trend: 'neutral',
      },
      {
        key: 'mortality',
        label: 'Taxa de Mortalidade',
        value: null,
        trend: 'neutral',
      },
      {
        key: 'morbidity',
        label: 'Taxa de Morbidade',
        value: null,
        trend: 'neutral',
      },
    ];
  }

  const sum = rows.reduce(
    (acc, row) => {
      acc.entries +=
        (row.metrics.entriesDogs ?? 0) +
        (row.metrics.entriesCats ?? 0) +
        (row.metrics.returnsDogs ?? 0) +
        (row.metrics.returnsCats ?? 0);
      acc.exits +=
        (row.metrics.adoptionsDogs ?? 0) +
        (row.metrics.adoptionsCats ?? 0) +
        (row.metrics.tutorReturnDogs ?? 0) +
        (row.metrics.tutorReturnCats ?? 0) +
        (row.metrics.originReturnDogs ?? 0) +
        (row.metrics.originReturnCats ?? 0) +
        (row.metrics.euthanasiasDogs ?? 0) +
        (row.metrics.euthanasiasCats ?? 0) +
        (row.metrics.naturalDeathsDogs ?? 0) +
        (row.metrics.naturalDeathsCats ?? 0);
      acc.adoptions +=
        (row.metrics.adoptionsDogs ?? 0) + (row.metrics.adoptionsCats ?? 0);
      acc.mortality +=
        (row.metrics.euthanasiasDogs ?? 0) +
        (row.metrics.euthanasiasCats ?? 0) +
        (row.metrics.naturalDeathsDogs ?? 0) +
        (row.metrics.naturalDeathsCats ?? 0);
      acc.morbidity +=
        (row.metrics.diseasesDogs ?? 0) + (row.metrics.diseasesCats ?? 0);
      return acc;
    },
    { entries: 0, exits: 0, adoptions: 0, mortality: 0, morbidity: 0 },
  );

  const toPercent = (value: number): number =>
    Number(((value / populationInitial) * 100).toFixed(2));

  return [
    {
      key: 'entry',
      label: 'Taxa de Entrada',
      value: toPercent(sum.entries),
      trend: 'up',
    },
    {
      key: 'exit',
      label: 'Taxa de Saída',
      value: toPercent(sum.exits),
      trend: 'down',
    },
    {
      key: 'adoption',
      label: 'Taxa de Adoção',
      value: toPercent(sum.adoptions),
      trend: 'up',
    },
    {
      key: 'mortality',
      label: 'Taxa de Mortalidade',
      value: toPercent(sum.mortality),
      trend: 'down',
    },
    {
      key: 'morbidity',
      label: 'Taxa de Morbidade',
      value: toPercent(sum.morbidity),
      trend: 'neutral',
    },
  ];
}

export function deriveDynamicType(record: DynamicsRecord): DynamicType {
  const kindValue = (record.kind || '').toString();
  if (kindValue === 'lar') return 'dinamica_lar';
  if (kindValue === 'abrigo') return 'dinamica';

  const value = (record.dynamicType || '').toString();
  if (value === 'dinamica_lar') return 'dinamica_lar';
  return 'dinamica';
}

function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function mapRecordToRow(record: DynamicsRecord): DynamicsTableRow {
  const metrics: DynamicsMetrics = {
    entriesDogs: record.entradasDeAnimais ?? 0,
    entriesCats: record.entradasDeGatos ?? 0,
    returnsDogs: record.devolucoesCaes ?? 0,
    returnsCats: record.devolucoesGatos ?? 0,
    adoptionsDogs: record.adocoesCaes ?? 0,
    adoptionsCats: record.adocoesGatos ?? 0,
    euthanasiasDogs: record.eutanasiasCaes ?? 0,
    euthanasiasCats: record.eutanasiasGatos ?? 0,
    naturalDeathsDogs: record.mortesNaturaisCaes ?? 0,
    naturalDeathsCats: record.mortesNaturaisGatos ?? 0,
    diseasesDogs: record.doencasCaes ?? 0,
    diseasesCats: record.doencasGatos ?? 0,
    tutorReturnDogs: record.retornoDeCaes ?? 0,
    tutorReturnCats: record.retornoDeGatos ?? 0,
    originReturnDogs: record.retornoLocalCaes ?? 0,
    originReturnCats: record.retornoLocalGatos ?? 0,
  };
  return {
    id: record.id,
    referenceLabel: parseReferenceLabel(record.referencePeriod),
    referenceDate: dateOnly(record.referenceDate),
    metrics,
    balance: computeBalance(metrics),
    cumulativeBalance: null,
  };
}

export function buildDisplay(
  records: DynamicsRecord[],
  dynamicType: DynamicType,
  populationInitial: number | null,
  populationFallback: number | null,
  populationDogs?: number | null,
  populationCats?: number | null,
): DynamicsDisplay {
  const filtered = records.filter(
    (item) => deriveDynamicType(item) === dynamicType,
  );
  const rows = filtered.map(mapRecordToRow);
  const populationInitialValue =
    populationInitial ?? populationFallback ?? null;
  const computeSpeciesCurrent = (
    initialDogs: number | null | undefined,
    initialCats: number | null | undefined,
  ) => {
    if (initialDogs === null && initialCats === null) {
      return { dogs: null, cats: null };
    }

    const totals = rows.reduce(
      (acc, row) => {
        acc.dogs +=
          (row.metrics.entriesDogs ?? 0) +
          (row.metrics.returnsDogs ?? 0) -
          ((row.metrics.adoptionsDogs ?? 0) +
            (row.metrics.tutorReturnDogs ?? 0) +
            (row.metrics.originReturnDogs ?? 0) +
            (row.metrics.euthanasiasDogs ?? 0) +
            (row.metrics.naturalDeathsDogs ?? 0));
        acc.cats +=
          (row.metrics.entriesCats ?? 0) +
          (row.metrics.returnsCats ?? 0) -
          ((row.metrics.adoptionsCats ?? 0) +
            (row.metrics.tutorReturnCats ?? 0) +
            (row.metrics.originReturnCats ?? 0) +
            (row.metrics.euthanasiasCats ?? 0) +
            (row.metrics.naturalDeathsCats ?? 0));
        return acc;
      },
      { dogs: 0, cats: 0 },
    );

    return {
      dogs:
        initialDogs !== null && initialDogs !== undefined
          ? initialDogs + totals.dogs
          : null,
      cats:
        initialCats !== null && initialCats !== undefined
          ? initialCats + totals.cats
          : null,
    };
  };

  const speciesCurrent = computeSpeciesCurrent(populationDogs, populationCats);
  const populationCurrent =
    populationInitialValue !== null
      ? populationInitialValue +
        rows.reduce((acc, row) => acc + (row.balance ?? 0), 0)
      : null;

  const sortedRows = rows.sort((a, b) => {
    const dateA = a.referenceDate ?? '';
    const dateB = b.referenceDate ?? '';
    return dateA.localeCompare(dateB);
  });

  let runningTotal = populationInitialValue ?? 0;
  const rowsWithCumulative = sortedRows.map((row) => {
    runningTotal += row.balance ?? 0;
    return {
      ...row,
      cumulativeBalance: populationInitialValue !== null ? runningTotal : null,
    };
  });

  return {
    dynamicType,
    title:
      dynamicType === 'dinamica_lar'
        ? 'Dinâmica Populacional L.T'
        : 'Dinâmica Populacional',
    populationInitial: populationInitialValue,
    populationCurrent,
    populationInitialDogs: populationDogs ?? null,
    populationInitialCats: populationCats ?? null,
    populationCurrentDogs: speciesCurrent.dogs,
    populationCurrentCats: speciesCurrent.cats,
    stats: computeRates(rows, populationInitialValue),
    rows: rowsWithCumulative,
  };
}

export function buildPopulationSummary(shelter: {
  initialDogs: number | null;
  initialCats: number | null;
  initialDogsLt?: number | null;
  initialCatsLt?: number | null;
}): PopulationSummaryValues {
  const shelterPopulationInitial =
    typeof shelter.initialDogs === 'number' &&
    typeof shelter.initialCats === 'number'
      ? (shelter.initialDogs ?? 0) + (shelter.initialCats ?? 0)
      : null;
  const ltPopulationInitial =
    typeof shelter.initialDogsLt === 'number' &&
    typeof shelter.initialCatsLt === 'number'
      ? (shelter.initialDogsLt ?? 0) + (shelter.initialCatsLt ?? 0)
      : null;

  return {
    shelterPopulationInitial,
    shelterPopulationInitialDogs: shelter.initialDogs ?? null,
    shelterPopulationInitialCats: shelter.initialCats ?? null,
    ltPopulationInitial,
    ltPopulationInitialDogs: shelter.initialDogsLt ?? null,
    ltPopulationInitialCats: shelter.initialCatsLt ?? null,
  };
}
