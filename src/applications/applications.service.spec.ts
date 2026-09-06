import { ConflictException, Logger } from '@nestjs/common';
import type { Claims } from '../auth/jwt/token.service';
import type { PrismaService } from '../prisma/prisma.service';
import { VacancyResolver } from '../vacancies/vacancy-resolver';
import { ApplicationsService } from './applications.service';

const loggerErrorSpy = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);
afterAll(() => loggerErrorSpy.mockRestore());

const claims: Claims = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'volunteer@example.com',
  role: 'voluntario',
  isTeamOnly: false,
  teamDisabled: false,
  creatorProfileId: null,
  sid: 'sid-volunteer',
};
const vacancy = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  shelterId: '22222222-2222-2222-2222-222222222222',
  title: 'Cuidador',
  status: 'active',
  isPublished: true,
};
const volunteer = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Maria',
  cidade: 'Curitiba',
  estado: 'PR',
  telefone: '41999999999',
  profissao: 'Veterinária',
  experiencia: 'Sim',
  slug: 'maria-33333333',
};
const dates = {
  appliedAt: new Date('2026-01-03T03:04:05.000Z'),
  createdAt: new Date('2026-01-03T03:04:06.000Z'),
  updatedAt: new Date('2026-01-03T03:04:07.000Z'),
};
const application = {
  id: '44444444-4444-4444-8444-444444444444',
  vacancyId: vacancy.id,
  volunteerId: volunteer.id,
  status: 'pending',
  ...dates,
};

type PrismaMock = {
  shelter: { findUnique: jest.Mock };
  volunteer: { findFirst: jest.Mock };
  vacancyApplication: { create: jest.Mock; findMany: jest.Mock };
};

describe('ApplicationsService', () => {
  let prisma: PrismaMock;
  let resolver: { resolveAny: jest.Mock; resolveForShelter: jest.Mock };
  let service: ApplicationsService;

  beforeEach(() => {
    prisma = {
      shelter: { findUnique: jest.fn() },
      volunteer: { findFirst: jest.fn() },
      vacancyApplication: { create: jest.fn(), findMany: jest.fn() },
    };
    resolver = {
      resolveAny: jest.fn(),
      resolveForShelter: jest.fn(),
    };
    service = new ApplicationsService(
      prisma as unknown as PrismaService,
      resolver as unknown as VacancyResolver,
    );
  });

  it('creates an application and serializes the exact snake_case row', async () => {
    prisma.volunteer.findFirst.mockResolvedValue(volunteer);
    resolver.resolveAny.mockResolvedValue(vacancy);
    prisma.vacancyApplication.create.mockResolvedValue(application);

    await expect(service.apply(claims, vacancy.id)).resolves.toEqual({
      application: {
        id: application.id,
        vacancy_id: vacancy.id,
        volunteer_id: volunteer.id,
        status: 'pending',
        applied_at: dates.appliedAt.toISOString(),
        created_at: dates.createdAt.toISOString(),
        updated_at: dates.updatedAt.toISOString(),
      },
      success: true,
    });
    expect(prisma.vacancyApplication.create).toHaveBeenCalledWith({
      data: {
        vacancyId: vacancy.id,
        volunteerId: volunteer.id,
        status: 'pending',
      },
    });
  });

  it('returns 404 for missing/error volunteer and vacancy lookups', async () => {
    prisma.volunteer.findFirst.mockResolvedValueOnce(null);
    await expect(service.apply(claims, vacancy.id)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Perfil de voluntário não encontrado' },
      }),
    );

    prisma.volunteer.findFirst.mockResolvedValueOnce(volunteer);
    resolver.resolveAny.mockResolvedValueOnce(null);
    await expect(service.apply(claims, vacancy.id)).rejects.toEqual(
      expect.objectContaining({ response: { error: 'Vaga não encontrada' } }),
    );

    prisma.volunteer.findFirst.mockRejectedValueOnce(new Error('db'));
    await expect(service.apply(claims, vacancy.id)).rejects.toHaveProperty(
      'response.error',
      'Perfil de voluntário não encontrado',
    );
  });

  it('rejects inactive or unpublished vacancies', async () => {
    prisma.volunteer.findFirst.mockResolvedValue(volunteer);
    resolver.resolveAny.mockResolvedValue({ ...vacancy, isPublished: false });

    await expect(service.apply(claims, vacancy.id)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Vaga não está disponível para candidaturas' },
      }),
    );

    resolver.resolveAny.mockResolvedValue({
      ...vacancy,
      status: 'inactive',
    });
    await expect(service.apply(claims, vacancy.id)).rejects.toHaveProperty(
      'response.error',
      'Vaga não está disponível para candidaturas',
    );
  });

  it.each([
    [{ code: 'P2002' }],
    [{ cause: { originalError: { code: '23505' } } }],
  ])('maps duplicate error %p to 409', async (error) => {
    prisma.volunteer.findFirst.mockResolvedValue(volunteer);
    resolver.resolveAny.mockResolvedValue(vacancy);
    prisma.vacancyApplication.create.mockRejectedValue(error);

    await expect(service.apply(claims, vacancy.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.apply(claims, vacancy.id)).rejects.toHaveProperty(
      'response.error',
      'Você já se candidatou a esta vaga',
    );
  });

  it('maps generic create errors to the legacy 500 message', async () => {
    prisma.volunteer.findFirst.mockResolvedValue(volunteer);
    resolver.resolveAny.mockResolvedValue(vacancy);
    prisma.vacancyApplication.create.mockRejectedValue(new Error('db'));

    await expect(service.apply(claims, vacancy.id)).rejects.toHaveProperty(
      'response.error',
      'Erro ao criar candidatura',
    );
  });

  it('scopes application listing to the owning shelter and maps PostgREST keys', async () => {
    prisma.shelter.findUnique.mockResolvedValue({ id: vacancy.shelterId });
    resolver.resolveForShelter.mockResolvedValue(vacancy);
    prisma.vacancyApplication.findMany.mockResolvedValue([
      { ...application, volunteer },
    ]);

    await expect(service.list(claims, vacancy.id)).resolves.toEqual({
      applications: [
        {
          id: application.id,
          status: application.status,
          applied_at: dates.appliedAt.toISOString(),
          created_at: dates.createdAt.toISOString(),
          volunteers: volunteer,
        },
      ],
    });
    expect(resolver.resolveForShelter).toHaveBeenCalledWith(
      vacancy.id,
      vacancy.shelterId,
    );
    expect(prisma.vacancyApplication.findMany).toHaveBeenCalledWith({
      where: { vacancyId: vacancy.id },
      orderBy: { appliedAt: 'desc' },
      include: {
        volunteer: {
          select: {
            id: true,
            name: true,
            cidade: true,
            estado: true,
            telefone: true,
            profissao: true,
            experiencia: true,
            slug: true,
          },
        },
      },
    });
  });

  it('prevents application listing IDOR and translates query failures', async () => {
    prisma.shelter.findUnique.mockResolvedValue({ id: vacancy.shelterId });
    resolver.resolveForShelter.mockResolvedValue(null);
    await expect(service.list(claims, vacancy.id)).rejects.toHaveProperty(
      'response.error',
      'Vaga não encontrada ou sem permissão',
    );

    resolver.resolveForShelter.mockResolvedValue(vacancy);
    prisma.vacancyApplication.findMany.mockRejectedValue(new Error('db'));
    await expect(service.list(claims, vacancy.id)).rejects.toHaveProperty(
      'response.error',
      'Erro ao buscar candidaturas',
    );
  });
});
