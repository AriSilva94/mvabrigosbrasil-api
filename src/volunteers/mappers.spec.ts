import {
  mapDbToFormData,
  mapPublicVolunteerCard,
  mapPublicVolunteerProfile,
  mapVolunteerProfileToDb,
} from './mappers';
import { resolveSlug } from '../common/utils/slug';
import type { VolunteerProfileInput } from './schemas/volunteer-profile.schema';

const payload: VolunteerProfileInput = {
  name: 'Maria Silva',
  telefone: '(41) 99999-1234',
  profissao: 'Veterinaria',
  faixa_etaria: '25-34',
  genero: 'Feminino',
  escolaridade: 'Superior completo',
  estado: 'PR',
  cidade: 'Curitiba',
  disponibilidade: 'Semanal',
  periodo: 'Matutino',
  experiencia: 'Sim',
  atuacao: 'Presencial',
  descricao: 'Cuidados com animais',
  comentarios: undefined,
  referralSource: 'Instagram',
  acceptTerms: true,
};

describe('volunteer profile mappers', () => {
  it('maps nullable Prisma fields to literal form defaults', () => {
    expect(
      mapDbToFormData({
        name: null,
        telefone: null,
        profissao: null,
        faixaEtaria: null,
        genero: null,
        escolaridade: null,
        estado: null,
        cidade: null,
        disponibilidade: null,
        periodo: null,
        experiencia: null,
        atuacao: null,
        descricao: null,
        comentarios: null,
        referralSource: null,
        acceptTerms: null,
        isPublic: null,
      }),
    ).toEqual({
      name: '',
      telefone: '',
      profissao: '',
      faixa_etaria: '',
      genero: '',
      escolaridade: '',
      estado: '',
      cidade: '',
      disponibilidade: '',
      periodo: '',
      experiencia: '',
      atuacao: '',
      descricao: '',
      comentarios: '',
      referral_source: '',
      acceptTerms: true,
      is_public: false,
    });
  });

  it('maps form data to Prisma camelCase and preserves D4 fields', () => {
    expect(mapVolunteerProfileToDb('profile-1', payload)).toEqual({
      ownerProfileId: 'profile-1',
      name: payload.name,
      telefone: '41999991234',
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
      comentarios: null,
      referralSource: payload.referralSource,
      acceptTerms: true,
      isPublic: true,
    });
  });
});

describe('public volunteer mappers', () => {
  const publicRow = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    wpPostId: 42,
    ownerProfileId: '11111111-1111-4111-8111-111111111111',
    name: 'Maria Silva',
    slug: null,
    telefone: '41999991234',
    cidade: ' Curitiba ',
    estado: ' PR ',
    profissao: 'Veterinaria',
    escolaridade: 'Superior completo',
    faixaEtaria: '25-34',
    genero: 'Feminino',
    experiencia: 'Sim',
    atuacao: 'Presencial',
    disponibilidade: 'Semanal',
    periodo: 'Matutino',
    descricao: 'Cuidados com animais',
    comentarios: 'Disponivel aos sabados',
    referralSource: 'Instagram',
    isPublic: true,
    acceptTerms: true,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-01-02T03:04:05.000Z'),
  };

  it('maps a public card with defaults, normalized slug, and trimmed location', () => {
    expect(mapPublicVolunteerCard(publicRow)).toEqual({
      id: publicRow.id,
      name: publicRow.name,
      slug: resolveSlug(null, publicRow.name, publicRow.id),
      createdAt: '2026-01-02T03:04:05.000Z',
      city: 'Curitiba',
      state: 'PR',
      location: 'Curitiba - PR',
      gender: publicRow.genero,
      availability: publicRow.disponibilidade,
      wpPostId: '42',
      source: 'new',
    });
  });

  it('maps card nulls to the literal name and optional defaults', () => {
    expect(
      mapPublicVolunteerCard({
        ...publicRow,
        name: null,
        cidade: null,
        estado: '  ',
        genero: null,
        disponibilidade: null,
        wpPostId: 0,
        createdAt: null,
      }),
    ).toEqual({
      id: publicRow.id,
      name: 'Voluntário',
      slug: resolveSlug(null, 'Voluntário', publicRow.id),
      createdAt: undefined,
      city: undefined,
      state: '',
      location: undefined,
      gender: undefined,
      availability: undefined,
      wpPostId: undefined,
      source: 'new',
    });
  });

  it('maps a public profile including owner email', () => {
    expect(
      mapPublicVolunteerProfile({
        ...publicRow,
        owner: { email: 'owner@example.com' },
      }),
    ).toEqual({
      id: publicRow.id,
      name: publicRow.name,
      slug: resolveSlug(null, publicRow.name, publicRow.id),
      createdAt: '2026-01-02T03:04:05.000Z',
      city: publicRow.cidade,
      state: publicRow.estado,
      profession: publicRow.profissao,
      schooling: publicRow.escolaridade,
      phone: publicRow.telefone,
      email: 'owner@example.com',
      ageRange: publicRow.faixaEtaria,
      experience: publicRow.experiencia,
      availability: publicRow.disponibilidade,
      skills: publicRow.descricao,
      period: publicRow.periodo,
      notes: publicRow.comentarios,
      wpPostId: '42',
      source: 'new',
    });
  });

  it('falls back from description to atuação and omits profile nulls', () => {
    expect(
      mapPublicVolunteerProfile({
        ...publicRow,
        name: null,
        createdAt: null,
        cidade: null,
        estado: null,
        profissao: null,
        escolaridade: null,
        telefone: null,
        faixaEtaria: null,
        experiencia: null,
        disponibilidade: null,
        descricao: null,
        comentarios: null,
        wpPostId: 0,
        owner: null,
      }),
    ).toMatchObject({
      name: 'Voluntário',
      createdAt: undefined,
      city: undefined,
      state: undefined,
      profession: undefined,
      schooling: undefined,
      phone: undefined,
      email: undefined,
      ageRange: undefined,
      experience: undefined,
      availability: undefined,
      skills: publicRow.atuacao,
      notes: undefined,
      wpPostId: undefined,
    });
  });
});
