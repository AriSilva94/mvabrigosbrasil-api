import type { ShelterProfileInput } from './schemas/shelter-profile.schema';
import {
  parseTemporaryAgreementValue,
  unformatDigits,
} from './schemas/shelter-profile.schema';

export type ShelterProfileFormData = {
  shelterType?: string;
  cnpj: string;
  name: string;
  cep: string;
  street: string;
  number: string;
  district: string;
  state: string;
  city: string;
  website: string;
  foundationDate: string;
  species: string;
  additionalSpecies: string[];
  hasTemporaryAgreement?: boolean | null;
  temporaryAgreement?: boolean | null;
  referralSource?: string;
  initialDogs: number;
  initialCats: number;
  initialDogsLt?: number | null;
  initialCatsLt?: number | null;
  authorizedName: string;
  authorizedRole: string;
  authorizedEmail: string;
  authorizedPhone: string;
  acceptTerms: boolean;
  active?: boolean;
};

export type ShelterProfileDbData = {
  profileId: string;
  shelterType: string;
  cnpj: string | null;
  cpf: string | null;
  name: string;
  cep: string;
  street: string;
  number: number;
  district: string;
  state: string;
  city: string;
  website: string | null | undefined;
  foundationDate: Date;
  species: string;
  additionalSpecies: string[];
  temporaryAgreement: boolean;
  referralSource: string;
  initialDogs: number;
  initialCats: number;
  initialDogsLt: number | null;
  initialCatsLt: number | null;
  authorizedName: string;
  authorizedRole: string;
  authorizedEmail: string;
  authorizedPhone: string;
  acceptTerms: boolean;
};

type ShelterLike = {
  profileId?: string | null;
  shelterType?: string | null;
  cnpj?: string | null;
  cpf?: string | null;
  name?: string | null;
  cep?: string | null;
  street?: string | null;
  number?: number | null;
  district?: string | null;
  state?: string | null;
  city?: string | null;
  website?: string | null;
  foundationDate?: Date | string | null;
  species?: string | null;
  additionalSpecies?: unknown;
  temporaryAgreement?: unknown;
  referralSource?: string | null;
  initialDogs?: number | null;
  initialCats?: number | null;
  initialDogsLt?: number | null;
  initialCatsLt?: number | null;
  authorizedName?: string | null;
  authorizedRole?: string | null;
  authorizedEmail?: string | null;
  authorizedPhone?: string | null;
  acceptTerms?: boolean | null;
  active?: boolean | null;
};

function toDateInput(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

export function dateOnly(value: Date | string | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function mapDbToFormData(row: ShelterLike): ShelterProfileFormData {
  const additionalSpecies = isStringArray(row.additionalSpecies)
    ? row.additionalSpecies
    : [];
  const temporaryAgreement = parseTemporaryAgreementValue(
    row.temporaryAgreement,
  );

  return {
    shelterType: row.shelterType ?? undefined,
    cnpj: row.cnpj ?? row.cpf ?? '',
    name: row.name ?? '',
    cep: row.cep ?? '',
    street: row.street ?? '',
    number: row.number?.toString?.() ?? '',
    district: row.district ?? '',
    state: typeof row.state === 'string' ? row.state.toUpperCase() : '',
    city: row.city ?? '',
    website: row.website ?? '',
    foundationDate: dateOnly(row.foundationDate),
    species: row.species ?? '',
    additionalSpecies,
    hasTemporaryAgreement: temporaryAgreement,
    temporaryAgreement,
    referralSource: row.referralSource ?? '',
    initialDogs: row.initialDogs ?? 0,
    initialCats: row.initialCats ?? 0,
    initialDogsLt: row.initialDogsLt ?? null,
    initialCatsLt: row.initialCatsLt ?? null,
    authorizedName: row.authorizedName ?? '',
    authorizedRole: row.authorizedRole ?? '',
    authorizedEmail: row.authorizedEmail ?? '',
    authorizedPhone: row.authorizedPhone ?? '',
    acceptTerms: Boolean(row.acceptTerms ?? false),
    active: row.active ?? true,
  };
}

export function mapShelterProfileToDb(
  profileId: string,
  payload: ShelterProfileInput,
): ShelterProfileDbData {
  const documentDigits = unformatDigits(payload.cnpj);
  const cepDigits = unformatDigits(payload.cep);
  const phoneDigits = unformatDigits(payload.authorizedPhone);
  const isTemporary = payload.shelterType === 'temporary';
  const hasTemporaryAgreement = payload.temporaryAgreement === true;
  const shouldPersistLtPopulation = !isTemporary && hasTemporaryAgreement;

  return {
    profileId,
    shelterType: payload.shelterType,
    cnpj: isTemporary ? null : documentDigits,
    cpf: isTemporary ? documentDigits : null,
    name: payload.shelterName,
    cep: cepDigits,
    street: payload.street,
    number: payload.number,
    district: payload.district,
    state: payload.state,
    city: payload.city,
    website: payload.website,
    foundationDate: toDateInput(payload.foundationDate),
    species: payload.species,
    additionalSpecies: payload.additionalSpecies ?? [],
    temporaryAgreement: isTemporary ? false : payload.temporaryAgreement,
    referralSource: payload.referralSource,
    initialDogs: payload.initialDogs,
    initialCats: payload.initialCats,
    initialDogsLt: shouldPersistLtPopulation
      ? (payload.initialDogsLt ?? null)
      : null,
    initialCatsLt: shouldPersistLtPopulation
      ? (payload.initialCatsLt ?? null)
      : null,
    authorizedName: payload.authorizedName,
    authorizedRole: payload.authorizedRole,
    authorizedEmail: payload.authorizedEmail,
    authorizedPhone: phoneDigits,
    acceptTerms: payload.acceptTerms,
  };
}

export function mapShelterToComparable(
  row: ShelterLike | null,
): Record<string, unknown> | null {
  if (!row) return null;

  return {
    profileId: row.profileId ?? null,
    shelterType: row.shelterType ?? null,
    cnpj: row.cnpj ?? null,
    cpf: row.cpf ?? null,
    name: row.name ?? null,
    cep: row.cep ?? null,
    street: row.street ?? null,
    number: row.number ?? null,
    district: row.district ?? null,
    state: row.state ?? null,
    city: row.city ?? null,
    website: row.website ?? null,
    foundationDate: dateOnly(row.foundationDate) || null,
    species: row.species ?? null,
    additionalSpecies: isStringArray(row.additionalSpecies)
      ? row.additionalSpecies
      : [],
    temporaryAgreement:
      parseTemporaryAgreementValue(row.temporaryAgreement) ?? null,
    referralSource: row.referralSource ?? null,
    initialDogs: row.initialDogs ?? null,
    initialCats: row.initialCats ?? null,
    initialDogsLt: row.initialDogsLt ?? null,
    initialCatsLt: row.initialCatsLt ?? null,
    authorizedName: row.authorizedName ?? null,
    authorizedRole: row.authorizedRole ?? null,
    authorizedEmail: row.authorizedEmail ?? null,
    authorizedPhone: row.authorizedPhone ?? null,
    acceptTerms: row.acceptTerms ?? null,
  };
}
