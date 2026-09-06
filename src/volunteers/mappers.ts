import type { VolunteerProfileInput } from './schemas/volunteer-profile.schema';
import { unformatDigits } from './schemas/volunteer-profile.schema';
import { resolveSlug } from '../common/utils/slug';

export type VolunteerProfileFormData = {
  name: string;
  telefone: string;
  profissao: string;
  faixa_etaria: string;
  genero: string;
  escolaridade: string;
  estado: string;
  cidade: string;
  disponibilidade: string;
  periodo: string;
  experiencia: string;
  atuacao: string;
  descricao: string;
  comentarios: string;
  referral_source: string;
  acceptTerms: boolean;
  is_public: boolean;
};

export type VolunteerProfileDbData = {
  ownerProfileId: string;
  name: string;
  telefone: string;
  profissao: string;
  faixaEtaria: string;
  genero: string;
  escolaridade: string;
  estado: string;
  cidade: string;
  disponibilidade: string;
  periodo: string;
  experiencia: string;
  atuacao: string;
  descricao: string;
  comentarios: string | null;
  referralSource: string;
  acceptTerms: boolean;
  isPublic: boolean;
};

export type VolunteerLike = {
  id?: string;
  wpPostId?: number | null;
  ownerProfileId?: string | null;
  name?: string | null;
  slug?: string | null;
  telefone?: string | null;
  profissao?: string | null;
  faixaEtaria?: string | null;
  genero?: string | null;
  escolaridade?: string | null;
  estado?: string | null;
  cidade?: string | null;
  disponibilidade?: string | null;
  periodo?: string | null;
  experiencia?: string | null;
  atuacao?: string | null;
  descricao?: string | null;
  comentarios?: string | null;
  referralSource?: string | null;
  acceptTerms?: boolean | null;
  isPublic?: boolean | null;
  createdAt?: Date | null;
  owner?: { email: string | null } | null;
};

export type VolunteerCard = {
  id: string;
  name: string;
  slug: string;
  createdAt?: string;
  city?: string;
  state?: string;
  location?: string;
  gender?: string;
  availability?: string;
  wpPostId?: string;
  source: 'new';
};

export type VolunteerProfile = {
  id: string;
  name: string;
  slug: string;
  createdAt?: string;
  city?: string;
  state?: string;
  profession?: string;
  schooling?: string;
  phone?: string;
  email?: string;
  ageRange?: string;
  experience?: string;
  availability?: string;
  skills?: string;
  period?: string;
  notes?: string;
  wpPostId?: string;
  source: 'new';
};

export function mapDbToFormData(row: VolunteerLike): VolunteerProfileFormData {
  return {
    name: row.name ?? '',
    telefone: row.telefone ?? '',
    profissao: row.profissao ?? '',
    faixa_etaria: row.faixaEtaria ?? '',
    genero: row.genero ?? '',
    escolaridade: row.escolaridade ?? '',
    estado: row.estado ?? '',
    cidade: row.cidade ?? '',
    disponibilidade: row.disponibilidade ?? '',
    periodo: row.periodo ?? '',
    experiencia: row.experiencia ?? '',
    atuacao: row.atuacao ?? '',
    descricao: row.descricao ?? '',
    comentarios: row.comentarios ?? '',
    referral_source: row.referralSource ?? '',
    acceptTerms: row.acceptTerms ?? true,
    is_public: row.isPublic ?? false,
  };
}

export function mapVolunteerProfileToDb(
  profileId: string,
  payload: VolunteerProfileInput,
): VolunteerProfileDbData {
  return {
    ownerProfileId: profileId,
    name: payload.name,
    telefone: unformatDigits(payload.telefone),
    profissao: payload.profissao,
    faixaEtaria: payload.faixa_etaria,
    genero: payload.genero,
    escolaridade: payload.escolaridade,
    estado: payload.estado,
    cidade: payload.cidade,
    disponibilidade: payload.disponibilidade,
    periodo: payload.periodo,
    experiencia: payload.experiencia,
    atuacao: payload.atuacao,
    descricao: payload.descricao,
    comentarios: payload.comentarios ?? null,
    referralSource: payload.referralSource,
    acceptTerms: payload.acceptTerms,
    isPublic: true,
  };
}

export function mapVolunteerToComparable(
  row: VolunteerLike | null,
): Record<string, unknown> | null {
  if (!row) return null;

  return {
    ownerProfileId: row.ownerProfileId ?? null,
    name: row.name ?? null,
    telefone: row.telefone ?? null,
    profissao: row.profissao ?? null,
    faixaEtaria: row.faixaEtaria ?? null,
    genero: row.genero ?? null,
    escolaridade: row.escolaridade ?? null,
    estado: row.estado ?? null,
    cidade: row.cidade ?? null,
    disponibilidade: row.disponibilidade ?? null,
    periodo: row.periodo ?? null,
    experiencia: row.experiencia ?? null,
    atuacao: row.atuacao ?? null,
    descricao: row.descricao ?? null,
    comentarios: row.comentarios ?? null,
    referralSource: row.referralSource ?? null,
    acceptTerms: row.acceptTerms ?? null,
    isPublic: row.isPublic ?? null,
  };
}

export function mapPublicVolunteerCard(row: VolunteerLike): VolunteerCard {
  const id = row.id ?? '';
  const name = row.name ?? 'Voluntário';
  const city = row.cidade?.trim();
  const state = row.estado?.trim();

  return {
    id,
    name,
    slug: resolveSlug(row.slug, name, id),
    createdAt: row.createdAt?.toISOString(),
    city,
    state,
    location: city && state ? `${city} - ${state}` : city || state || undefined,
    gender: row.genero ?? undefined,
    availability: row.disponibilidade ?? undefined,
    wpPostId: row.wpPostId ? String(row.wpPostId) : undefined,
    source: 'new',
  };
}

export function mapPublicVolunteerProfile(
  row: VolunteerLike,
): VolunteerProfile {
  const id = row.id ?? '';
  const name = row.name ?? 'Voluntário';

  return {
    id,
    name,
    slug: resolveSlug(row.slug, name, id),
    createdAt: row.createdAt?.toISOString(),
    city: row.cidade ?? undefined,
    state: row.estado ?? undefined,
    profession: row.profissao ?? undefined,
    schooling: row.escolaridade ?? undefined,
    phone: row.telefone ?? undefined,
    email: row.owner?.email ?? undefined,
    ageRange: row.faixaEtaria ?? undefined,
    experience: row.experiencia ?? undefined,
    availability: row.disponibilidade ?? undefined,
    skills: row.descricao ?? row.atuacao ?? undefined,
    period: row.periodo ?? undefined,
    notes: row.comentarios ?? undefined,
    wpPostId: row.wpPostId ? String(row.wpPostId) : undefined,
    source: 'new',
  };
}
