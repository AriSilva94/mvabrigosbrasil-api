import type { Vacancy } from '../generated/prisma/client';
import { buildVacancySlug } from '../common/utils/slug';

export type VacancyProfile = {
  id: string;
  title: string;
  slug: string;
  city?: string;
  state?: string;
  period?: string;
  workload?: string;
  demand?: string;
  area?: string;
  quantity?: string;
  isPublished?: boolean;
  shelter?: string;
  description?: string;
  skills?: string;
  volunteerProfile?: string;
};

export type VacancyCard = {
  id: string;
  title: string;
  slug: string;
  period?: string;
  workload?: string;
  location?: string;
};

export const PERIOD_NORMALIZATION: Record<string, string> = {
  Matutino: 'manhã',
  Vespertino: 'tarde',
  Noturno: 'noite',
  Integral: 'integral',
  'Meio Período': 'meio-periodo',
  'Qualquer Período': 'flexível',
  Flexível: 'flexível',
};

export const WORKLOAD_NORMALIZATION: Record<string, string> = {
  '1h': '1h',
  '2h': '2h',
  '3h': '3h',
  '4h': '4h',
  '5h': '5h',
  '8h': '8h',
  '12h': '12h',
  '20h': '20h',
  '40h': '40h',
  Flexível: 'flexível',
};

export function normalizePeriod(value: string | null | undefined): string {
  if (!value) return '';
  return PERIOD_NORMALIZATION[value] || value.toLowerCase();
}

export function normalizeWorkload(value: string | null | undefined): string {
  if (!value) return '';
  return WORKLOAD_NORMALIZATION[value] || value.toLowerCase();
}

export function mapVacancyRow(row: Vacancy): VacancyProfile {
  const title = typeof row.title === 'string' ? row.title : 'Vaga';
  const slug =
    (typeof row.slug === 'string' ? row.slug : null) ||
    buildVacancySlug(title, row.id);

  return {
    id: row.id,
    title,
    slug,
    city: typeof row.cidade === 'string' ? row.cidade : undefined,
    state: typeof row.estado === 'string' ? row.estado : undefined,
    period: typeof row.periodo === 'string' ? row.periodo : undefined,
    workload:
      typeof row.cargaHoraria === 'string' ? row.cargaHoraria : undefined,
    demand: typeof row.tipoDemanda === 'string' ? row.tipoDemanda : undefined,
    area: typeof row.areaAtuacao === 'string' ? row.areaAtuacao : undefined,
    quantity: typeof row.quantidade === 'string' ? row.quantidade : undefined,
    isPublished:
      typeof row.isPublished === 'boolean' ? row.isPublished : undefined,
    shelter: undefined,
    description:
      typeof row.description === 'string' ? row.description : undefined,
    skills:
      typeof row.habilidadesEFuncoes === 'string'
        ? row.habilidadesEFuncoes
        : undefined,
    volunteerProfile:
      typeof row.perfilDosVoluntarios === 'string'
        ? row.perfilDosVoluntarios
        : undefined,
  };
}

export function mapPublicVacancyCard(row: Vacancy): VacancyCard {
  const city = row.cidade?.trim();
  const state = row.estado?.trim();

  return {
    id: String(row.wpPostId || row.id),
    title: row.title ?? 'Vaga',
    slug: typeof row.slug === 'string' ? row.slug : String(row.id),
    period: normalizePeriod(row.periodo) || undefined,
    workload: normalizeWorkload(row.cargaHoraria) || undefined,
    location: city && state ? `${city} - ${state}` : city || state || undefined,
  };
}
