export type ShelterDatasetRow = {
  id: string;
  wpPostId: number | null;
  name: string;
  state: string | null;
  shelterType: string | null;
  foundationDate: Date | null;
  createdAt: Date;
};

export type DynamicsDatasetRow = {
  id: string;
  shelterId: string;
  kind: string;
  dynamicType: string;
  referenceDate: Date | null;
  referencePeriod: string | null;
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
  retornoDeCaes: number | null;
  retornoDeGatos: number | null;
  retornoLocalCaes: number | null;
  retornoLocalGatos: number | null;
};

export type ShelterRecord = {
  id: number;
  title: string;
  postDate: string;
  year: number;
  month: number;
  state?: string;
  type?: string;
};

export type MovementRecord = {
  id: number;
  postType: 'dinamica' | 'dinamica_lar';
  year: number;
  month: number;
  shelterId: number | null;
  shelterState?: string;
  shelterType?: string;
  metrics: {
    entradas: number;
    entradasGatos: number;
    adocoes: number;
    adocoesGatos: number;
    devolucoes: number;
    devolucoesGatos: number;
    eutanasias: number;
    eutanasiasGatos: number;
    mortesNaturais: number;
    mortesNaturaisGatos: number;
    retornoTutor: number;
    retornoTutorGatos: number;
    retornoLocal: number;
    retornoLocalGatos: number;
  };
};

export type DatabaseDataset = {
  shelters: ShelterRecord[];
  movements: MovementRecord[];
  years: number[];
  states: string[];
};

function parseDateParts(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return { year: value.getFullYear(), month: value.getMonth() + 1 };
  }

  const serialized = value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(serialized);
  const hasExplicitTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(serialized);

  if (match && !hasExplicitTimezone) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    ) {
      return { year, month };
    }
  }

  const parsed = new Date(serialized);
  if (Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1 };
}

export function parseYear(value: string | Date | null | undefined): number {
  return parseDateParts(value)?.year ?? 0;
}

export function parseMonth(value: string | Date | null | undefined): number {
  return parseDateParts(value)?.month ?? 1;
}

export function parseMetaNumber(
  value: string | number | null | undefined,
): number {
  if (value === null || value === undefined) return 0;
  const normalized = String(value).replace(',', '.').trim();
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeState(state: string | null | undefined): string | undefined {
  const trimmed = state?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function normalizeShelterType(
  shelterType: string | null | undefined,
): string | undefined {
  if (!shelterType) return undefined;
  const typeMap: Record<string, string> = {
    public: 'Público',
    private: 'Privado',
    mixed: 'Misto',
    temporary: 'LT-PI',
  };
  return typeMap[shelterType] || shelterType;
}

function serializeDate(value: Date): string {
  return value.toISOString();
}

function serializeDateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

export function buildDatabaseDataset(
  shelterRows: ShelterDatasetRow[],
  dynamicsRows: DynamicsDatasetRow[],
): DatabaseDataset {
  const shelters: ShelterRecord[] = shelterRows.map((shelter) => {
    const dateToUse = serializeDate(shelter.createdAt);
    return {
      id: Number(shelter.wpPostId ?? 0),
      title: shelter.name ?? '',
      postDate: dateToUse,
      year: parseYear(dateToUse),
      month: parseMonth(dateToUse),
      state: normalizeState(shelter.state),
      type: normalizeShelterType(shelter.shelterType),
    };
  });

  // Abrigos cadastrados fora do WordPress não têm wpPostId, então o vínculo é pelo UUID.
  const shelterLookupByUuid = new Map(
    shelterRows.map((shelterRow, index) => [shelterRow.id, shelters[index]]),
  );

  const movements: MovementRecord[] = dynamicsRows.map((dynamic) => {
    const shelter = shelterLookupByUuid.get(dynamic.shelterId);
    const hashString = `${dynamic.shelterId}-${dynamic.referencePeriod}-${dynamic.dynamicType}`;
    const id = Math.abs(
      hashString.split('').reduce((hash, char) => {
        return (hash << 5) - hash + char.charCodeAt(0);
      }, 0),
    );

    return {
      id,
      postType:
        dynamic.dynamicType === 'dinamica_lar' ? 'dinamica_lar' : 'dinamica',
      year: parseYear(serializeDateOnly(dynamic.referenceDate)),
      month: parseMonth(serializeDateOnly(dynamic.referenceDate)),
      shelterId: shelter?.id ?? null,
      shelterState: shelter?.state,
      shelterType: shelter?.type,
      metrics: {
        entradas: parseMetaNumber(dynamic.entradasDeAnimais),
        entradasGatos: parseMetaNumber(dynamic.entradasDeGatos),
        adocoes: parseMetaNumber(dynamic.adocoesCaes),
        adocoesGatos: parseMetaNumber(dynamic.adocoesGatos),
        devolucoes: parseMetaNumber(dynamic.devolucoesCaes),
        devolucoesGatos: parseMetaNumber(dynamic.devolucoesGatos),
        eutanasias: parseMetaNumber(dynamic.eutanasiasCaes),
        eutanasiasGatos: parseMetaNumber(dynamic.eutanasiasGatos),
        mortesNaturais: parseMetaNumber(dynamic.mortesNaturaisCaes),
        mortesNaturaisGatos: parseMetaNumber(dynamic.mortesNaturaisGatos),
        retornoTutor:
          parseMetaNumber(dynamic.retornoDeCaes) +
          parseMetaNumber(dynamic.retornoDeGatos),
        retornoTutorGatos: parseMetaNumber(dynamic.retornoDeGatos),
        retornoLocal:
          parseMetaNumber(dynamic.retornoLocalCaes) +
          parseMetaNumber(dynamic.retornoLocalGatos),
        retornoLocalGatos: parseMetaNumber(dynamic.retornoLocalGatos),
      },
    };
  });

  const years = Array.from(
    new Set([
      ...shelters.map((item) => item.year),
      ...movements.map((item) => item.year),
    ]),
  )
    .filter((year) => Number.isFinite(year) && year > 0)
    .sort((a, b) => b - a);

  const states = Array.from(
    new Set(
      shelters.map((shelter) => shelter.state).filter(Boolean) as string[],
    ),
  ).sort();

  return { shelters, movements, years, states };
}
