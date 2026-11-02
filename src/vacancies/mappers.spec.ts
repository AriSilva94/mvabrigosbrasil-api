import { buildVacancySlug } from '../common/utils/slug';
import {
  mapPublicVacancyCard,
  mapVacancyRow,
  normalizePeriod,
  normalizeWorkload,
} from './mappers';

const row = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  wpPostId: 42,
  shelterId: '223e4567-e89b-12d3-a456-426614174000',
  shelterNameRaw: null,
  title: 'Cuidador de Cães',
  slug: null,
  description: 'Descrição',
  status: 'active',
  periodo: 'Matutino',
  cargaHoraria: '4h',
  cidade: ' São Paulo ',
  estado: ' SP ',
  tipoDemanda: 'Recorrente',
  areaAtuacao: 'Cuidados',
  quantidade: '2',
  inscritos: null,
  isPublished: true,
  habilidadesEFuncoes: 'Cuidar',
  perfilDosVoluntarios: 'Adultos',
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  updatedAt: new Date('2026-01-02T03:04:05.000Z'),
};

describe('vacancy mappers', () => {
  it('maps a Prisma vacancy to the legacy VacancyProfile contract', () => {
    expect(mapVacancyRow(row)).toEqual({
      id: row.id,
      title: row.title,
      slug: buildVacancySlug(row.title, row.id),
      city: row.cidade,
      state: row.estado,
      period: row.periodo,
      workload: row.cargaHoraria,
      demand: row.tipoDemanda,
      area: row.areaAtuacao,
      quantity: row.quantidade,
      isPublished: true,
      shelter: undefined,
      description: row.description,
      skills: row.habilidadesEFuncoes,
      volunteerProfile: row.perfilDosVoluntarios,
    });
  });

  it('omits nullable optional values and defaults the title', () => {
    expect(
      mapVacancyRow({
        ...row,
        title: null as unknown as string,
        cidade: null,
        estado: null,
        periodo: null,
        cargaHoraria: null,
        tipoDemanda: null,
        areaAtuacao: null,
        quantidade: null,
        isPublished: null,
        description: null,
        habilidadesEFuncoes: null,
        perfilDosVoluntarios: null,
      }),
    ).toEqual({
      id: row.id,
      title: 'Vaga',
      slug: buildVacancySlug('Vaga', row.id),
      city: undefined,
      state: undefined,
      period: undefined,
      workload: undefined,
      demand: undefined,
      area: undefined,
      quantity: undefined,
      isPublished: undefined,
      shelter: undefined,
      description: undefined,
      skills: undefined,
      volunteerProfile: undefined,
    });
  });

  it.each([
    ['Matutino', 'manhã'],
    ['Vespertino', 'tarde'],
    ['Noturno', 'noite'],
    ['Integral', 'integral'],
    ['Meio Período', 'meio-periodo'],
    ['Qualquer Período', 'flexível'],
    ['Flexível', 'flexível'],
    ['PERSONALIZADO', 'personalizado'],
    [null, ''],
  ])('normalizes period %p as %p', (input, expected) => {
    expect(normalizePeriod(input)).toBe(expected);
  });

  it.each([
    ['1h', '1h'],
    ['40h', '40h'],
    ['Flexível', 'flexível'],
    ['SEMANAL', 'semanal'],
    [undefined, ''],
  ])('normalizes workload %p as %p', (input, expected) => {
    expect(normalizeWorkload(input)).toBe(expected);
  });

  it('maps a public card with wp id, normalized filters, and trimmed location', () => {
    expect(mapPublicVacancyCard(row)).toEqual({
      id: '42',
      title: row.title,
      slug: row.id,
      period: 'manhã',
      workload: '4h',
      location: 'São Paulo - SP',
    });
  });
});
