import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Claims } from '../auth/jwt/token.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { VacancyFormInput } from './schemas/vacancy.schema';
import { VacancyResolver } from './vacancy-resolver';
import { VacanciesService } from './vacancies.service';

const loggerErrorSpy = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

afterAll(() => loggerErrorSpy.mockRestore());

const claims: Claims = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'owner@example.com',
  role: 'abrigo',
  isTeamOnly: false,
  teamDisabled: false,
  creatorProfileId: null,
  sid: 'sid-owner',
};
const shelter = {
  id: '22222222-2222-2222-2222-222222222222',
  city: 'Curitiba',
  state: 'PR',
};
const vacancy = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  wpPostId: null,
  shelterId: shelter.id,
  shelterNameRaw: null,
  title: 'Cuidador',
  slug: 'cuidador-123e4567',
  description: 'Descrição',
  status: 'active',
  periodo: 'Matutino',
  cargaHoraria: '4h',
  cidade: shelter.city,
  estado: shelter.state,
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
const payload: VacancyFormInput = {
  post_title: vacancy.title,
  post_periodo: vacancy.periodo,
  post_carga: vacancy.cargaHoraria,
  post_tipo_demanda: vacancy.tipoDemanda,
  post_area_atuacao: vacancy.areaAtuacao,
  post_quantidade: vacancy.quantidade,
  post_is_published: true,
  post_content: vacancy.description,
  post_habilidades_e_funcoes: vacancy.habilidadesEFuncoes,
  post_perfil_dos_voluntarios: vacancy.perfilDosVoluntarios,
};

type PrismaMock = {
  shelter: { findUnique: jest.Mock };
  vacancy: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  volunteer: { findFirst: jest.Mock };
  vacancyApplication: { findFirst: jest.Mock };
};

function createPrismaMock(): PrismaMock {
  return {
    shelter: { findUnique: jest.fn() },
    vacancy: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    volunteer: { findFirst: jest.fn() },
    vacancyApplication: { findFirst: jest.fn() },
  };
}

describe('VacanciesService', () => {
  let prisma: PrismaMock;
  let resolver: { resolveForShelter: jest.Mock; resolvePublic: jest.Mock };
  let service: VacanciesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    resolver = {
      resolveForShelter: jest.fn(),
      resolvePublic: jest.fn(),
    };
    service = new VacanciesService(
      prisma as unknown as PrismaService,
      resolver as unknown as VacancyResolver,
    );
  });

  it('returns an empty list without querying vacancies when no shelter exists', async () => {
    prisma.shelter.findUnique.mockResolvedValue(null);

    await expect(service.list(claims)).resolves.toEqual({ vacancies: [] });
    expect(prisma.vacancy.findMany).not.toHaveBeenCalled();
  });

  it('loads newest vacancies first and maps the legacy source', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    prisma.vacancy.findMany.mockResolvedValue([vacancy]);

    const result = await service.list(claims);

    expect(prisma.vacancy.findMany).toHaveBeenCalledWith({
      where: { shelterId: shelter.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(result.vacancies[0]).toMatchObject({
      id: vacancy.id,
      source: 'supabase',
    });
  });

  it('translates shelter and vacancy lookup failures separately', async () => {
    prisma.shelter.findUnique.mockRejectedValueOnce(new Error('db'));
    await expect(service.list(claims)).rejects.toEqual(
      expect.objectContaining({ response: { error: 'Erro ao buscar abrigo' } }),
    );

    prisma.shelter.findUnique.mockResolvedValueOnce(shelter);
    prisma.vacancy.findMany.mockRejectedValueOnce(new Error('db'));
    await expect(service.list(claims)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Erro ao carregar vagas' },
      }),
    );
  });

  it('creates with literal field mapping and persists the generated slug', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    prisma.vacancy.create.mockResolvedValue({ ...vacancy, slug: null });
    prisma.vacancy.update.mockResolvedValue(vacancy);

    const result = await service.create(claims, payload);

    expect(prisma.vacancy.create).toHaveBeenCalledWith({
      data: {
        shelterId: shelter.id,
        title: payload.post_title,
        description: payload.post_content,
        cidade: shelter.city,
        estado: shelter.state,
        areaAtuacao: payload.post_area_atuacao,
        cargaHoraria: payload.post_carga,
        periodo: payload.post_periodo,
        quantidade: payload.post_quantidade,
        isPublished: payload.post_is_published,
        habilidadesEFuncoes: payload.post_habilidades_e_funcoes,
        perfilDosVoluntarios: payload.post_perfil_dos_voluntarios,
        tipoDemanda: payload.post_tipo_demanda,
        status: 'active',
      },
    });
    expect(prisma.vacancy.update).toHaveBeenCalledWith({
      where: { id: vacancy.id },
      data: { slug: vacancy.slug },
    });
    expect(result).toEqual({
      vacancy: expect.objectContaining({
        id: vacancy.id,
        slug: vacancy.slug,
        source: 'supabase',
      }) as unknown,
    });
  });

  it('returns the inserted row with mapper slug fallback if slug update fails', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    prisma.vacancy.create.mockResolvedValue({ ...vacancy, slug: null });
    prisma.vacancy.update.mockRejectedValue(new Error('slug collision'));

    await expect(service.create(claims, payload)).resolves.toEqual({
      vacancy: expect.objectContaining({
        slug: vacancy.slug,
        source: 'supabase',
      }) as unknown,
    });
  });

  it('returns the owner vacancy resolved inside the shelter', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    resolver.resolveForShelter.mockResolvedValue(vacancy);

    await expect(service.get(claims, 'cuidador-123e4567')).resolves.toEqual({
      vacancy: expect.objectContaining({
        id: vacancy.id,
        source: 'supabase',
      }) as unknown,
    });
    expect(resolver.resolveForShelter).toHaveBeenCalledWith(
      'cuidador-123e4567',
      shelter.id,
    );
  });

  it('updates only mutable fields after scoped resolution', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    resolver.resolveForShelter.mockResolvedValue(vacancy);
    let capturedUpdate: { data: Record<string, unknown> } | undefined;
    prisma.vacancy.update.mockImplementation((args: unknown) => {
      capturedUpdate = args as { data: Record<string, unknown> };
      return Promise.resolve({ ...vacancy, title: 'Novo' });
    });

    await service.update(claims, vacancy.id, {
      ...payload,
      post_title: 'Novo',
    });

    expect(prisma.vacancy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: vacancy.id, shelterId: shelter.id },
      }),
    );
    expect(capturedUpdate?.data).not.toHaveProperty('cidade');
    expect(capturedUpdate?.data).not.toHaveProperty('estado');
    expect(capturedUpdate?.data).not.toHaveProperty('status');
    expect(capturedUpdate?.data).not.toHaveProperty('slug');
  });

  it('uses the legacy create path for an identifier with no resolvable suffix', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    prisma.vacancy.create.mockResolvedValue({ ...vacancy, slug: null });

    await expect(service.update(claims, 'nova-vaga', payload)).resolves.toEqual(
      {
        vacancy: expect.objectContaining({
          id: vacancy.id,
          source: 'supabase',
        }) as unknown,
      },
    );
    expect(resolver.resolveForShelter).not.toHaveBeenCalled();
    expect(prisma.vacancy.create).toHaveBeenCalled();
  });

  it('deletes only a vacancy resolved inside the owner shelter', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    resolver.resolveForShelter.mockResolvedValue(vacancy);
    prisma.vacancy.deleteMany.mockResolvedValue({ count: 1 });

    await expect(service.remove(claims, vacancy.id)).resolves.toEqual({
      success: true,
      message: 'Vaga deletada com sucesso',
    });
    expect(prisma.vacancy.deleteMany).toHaveBeenCalledWith({
      where: { id: vacancy.id, shelterId: shelter.id },
    });
  });

  it('prevents IDOR when the vacancy is not resolved in the owner shelter', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    resolver.resolveForShelter.mockResolvedValue(null);

    await expect(service.remove(claims, vacancy.id)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Vaga não encontrada ou sem permissão' },
      }),
    );
    expect(prisma.vacancy.deleteMany).not.toHaveBeenCalled();
  });

  it('returns anonymous status without database access', async () => {
    await expect(service.getMyStatus(undefined, vacancy.slug)).resolves.toEqual(
      {
        isOwner: false,
        hasApplied: false,
      },
    );
    expect(prisma.shelter.findUnique).not.toHaveBeenCalled();
  });

  it('returns owner status for unpublished own vacancies', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    resolver.resolveForShelter.mockResolvedValue({
      ...vacancy,
      isPublished: false,
    });

    await expect(service.getMyStatus(claims, vacancy.slug)).resolves.toEqual({
      isOwner: true,
      hasApplied: false,
    });
    expect(resolver.resolvePublic).not.toHaveBeenCalled();
  });

  it('reports whether a volunteer applied to a public vacancy', async () => {
    prisma.shelter.findUnique.mockResolvedValue(null);
    resolver.resolveForShelter.mockResolvedValue(null);
    resolver.resolvePublic.mockResolvedValue(vacancy);
    prisma.volunteer.findFirst.mockResolvedValue({ id: 'volunteer-1' });
    prisma.vacancyApplication.findFirst.mockResolvedValue({ id: 'app-1' });

    await expect(service.getMyStatus(claims, vacancy.slug)).resolves.toEqual({
      isOwner: false,
      hasApplied: true,
    });
    expect(prisma.vacancyApplication.findFirst).toHaveBeenCalledWith({
      where: { vacancyId: vacancy.id, volunteerId: 'volunteer-1' },
      select: { id: true },
    });
  });

  it('does not expose unpublished vacancies to a candidate', async () => {
    prisma.shelter.findUnique.mockResolvedValue(null);
    resolver.resolvePublic.mockResolvedValue(null);

    await expect(service.getMyStatus(claims, vacancy.slug)).resolves.toEqual({
      isOwner: false,
      hasApplied: false,
    });
    expect(prisma.volunteer.findFirst).not.toHaveBeenCalled();
  });

  it('returns ordered active published public cards', async () => {
    prisma.vacancy.findMany.mockResolvedValue([vacancy]);

    const result = await service.listPublic();

    expect(prisma.vacancy.findMany).toHaveBeenCalledWith({
      where: { status: 'active', isPublished: true },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual({
      vacancies: [expect.objectContaining({ id: vacancy.id })],
    });
  });

  it('logs repository failures and returns an empty public card list', async () => {
    prisma.vacancy.findMany.mockRejectedValue(new Error('db'));
    await expect(service.listPublic()).resolves.toEqual({ vacancies: [] });
  });

  it('loads public detail by exact slug before prefix fallback', async () => {
    prisma.vacancy.findFirst.mockResolvedValue(vacancy);

    await expect(service.getPublic(` ${vacancy.slug} `)).resolves.toEqual(
      expect.objectContaining({ id: vacancy.id, source: 'supabase' }),
    );
    expect(prisma.vacancy.findFirst).toHaveBeenCalledWith({
      where: {
        slug: vacancy.slug,
        status: 'active',
        isPublished: true,
      },
    });
    expect(resolver.resolvePublic).not.toHaveBeenCalled();
  });

  it('uses public UUID-prefix fallback and converts lookup failures to 404', async () => {
    prisma.vacancy.findFirst.mockResolvedValue(null);
    resolver.resolvePublic.mockResolvedValueOnce(vacancy);
    await expect(service.getPublic(vacancy.slug)).resolves.toEqual(
      expect.objectContaining({ id: vacancy.id }),
    );

    prisma.vacancy.findFirst.mockRejectedValueOnce(new Error('db'));
    resolver.resolvePublic.mockRejectedValueOnce(new Error('db'));
    await expect(service.getPublic(vacancy.slug)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('uses exact legacy messages for missing shelter and write errors', async () => {
    prisma.shelter.findUnique.mockResolvedValueOnce(null);
    await expect(service.create(claims, payload)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Abrigo não encontrado para o usuário.' },
      }),
    );

    prisma.shelter.findUnique.mockResolvedValueOnce(shelter);
    prisma.vacancy.create.mockRejectedValueOnce(new Error('db'));
    await expect(service.create(claims, payload)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
