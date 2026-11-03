/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Supertest exposes parsed JSON bodies as any; Jest assertions validate the wire contract here. */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { TokenService, type Claims } from '../src/auth/jwt/token.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { tokensWithSessions } from './helpers/active-session';

const NOOP_THROTTLER_STORAGE: ThrottlerStorage = {
  increment: () =>
    Promise.resolve({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
};

const EMAILS = {
  owner: 'e2e+data-b-vacancies-owner@test.local',
  otherOwner: 'e2e+data-b-vacancies-other@test.local',
  disabled: 'e2e+data-b-vacancies-disabled@test.local',
  volunteer: 'e2e+data-b-vacancies-volunteer@test.local',
  wrongRole: 'e2e+data-b-vacancies-role@test.local',
} as const;

const VACANCY_BODY = {
  post_title: 'Cuidador E2E Fatia B',
  post_periodo: 'Matutino',
  post_carga: '4h',
  post_tipo_demanda: 'Recorrente',
  post_area_atuacao: 'Cuidados',
  post_quantidade: '2',
  post_is_published: true,
  post_content: 'Apoio aos animais do abrigo.',
  post_habilidades_e_funcoes: 'Organização e cuidado.',
  post_perfil_dos_voluntarios: 'Pessoa responsável.',
};

describe('Data domains E2E - vacancies and applications (slice B)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let baseline: Record<
    'users' | 'shelters' | 'vacancies' | 'volunteers' | 'applications',
    number
  >;
  let ownerId: string;
  let otherOwnerId: string;
  let disabledId: string;
  let volunteerUserId: string;
  let wrongRoleId: string;
  let ownerShelterId: string;
  let otherShelterId: string;
  let disabledShelterId: string;
  let volunteerId: string;
  let fixtureVacancyId: string;
  let createdVacancyId: string | undefined;
  let createdVacancySlug: string | undefined;

  const auth = async (
    sub: string,
    email: string,
    role: Claims['role'],
    overrides: Partial<Claims> = {},
  ) => {
    const token = await tokenService.sign({
      sub,
      email,
      role,
      isTeamOnly: false,
      teamDisabled: false,
      creatorProfileId: null,
      sid: `e2e-data-b-vacancies-${sub}`,
      ...overrides,
    });
    return `Bearer ${token}`;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(NOOP_THROTTLER_STORAGE)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    tokenService = tokensWithSessions(app);
    baseline = {
      users: await prisma.user.count(),
      shelters: await prisma.shelter.count(),
      vacancies: await prisma.vacancy.count(),
      volunteers: await prisma.volunteer.count(),
      applications: await prisma.vacancyApplication.count(),
    };

    const [owner, otherOwner, disabled, volunteerUser, wrongRole] =
      await Promise.all([
        prisma.user.create({
          data: { email: EMAILS.owner, role: 'abrigo', wpUserId: 900821 },
        }),
        prisma.user.create({
          data: {
            email: EMAILS.otherOwner,
            role: 'abrigo',
            wpUserId: 900822,
          },
        }),
        prisma.user.create({
          data: {
            email: EMAILS.disabled,
            role: 'abrigo',
            wpUserId: 900823,
            isTeamOnly: true,
            teamDisabled: true,
          },
        }),
        prisma.user.create({
          data: {
            email: EMAILS.volunteer,
            role: 'voluntario',
            wpUserId: 900824,
          },
        }),
        prisma.user.create({
          data: {
            email: EMAILS.wrongRole,
            role: 'voluntario',
            wpUserId: 900825,
          },
        }),
      ]);
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    disabledId = disabled.id;
    volunteerUserId = volunteerUser.id;
    wrongRoleId = wrongRole.id;

    const [ownerShelter, otherShelter, disabledShelter] = await Promise.all([
      prisma.shelter.create({
        data: {
          name: 'Abrigo E2E Fatia B A',
          profileId: ownerId,
          wpPostId: 900831,
          city: 'Porto Alegre',
          state: 'RS',
        },
      }),
      prisma.shelter.create({
        data: {
          name: 'Abrigo E2E Fatia B B',
          profileId: otherOwnerId,
          wpPostId: 900832,
          city: 'Canoas',
          state: 'RS',
        },
      }),
      prisma.shelter.create({
        data: {
          name: 'Abrigo E2E Fatia B Desabilitado',
          profileId: disabledId,
          wpPostId: 900833,
          city: 'Esteio',
          state: 'RS',
        },
      }),
    ]);
    ownerShelterId = ownerShelter.id;
    otherShelterId = otherShelter.id;
    disabledShelterId = disabledShelter.id;

    const volunteer = await prisma.volunteer.create({
      data: {
        ownerProfileId: volunteerUserId,
        wpPostId: 900841,
        name: 'Voluntário E2E Vagas',
        slug: 'voluntario-e2e-vagas',
        acceptTerms: true,
        isPublic: true,
        cidade: 'Porto Alegre',
        estado: 'RS',
        telefone: '51999999999',
        profissao: 'Cuidador',
        experiencia: 'Sim',
      },
    });
    volunteerId = volunteer.id;

    const fixtureVacancy = await prisma.vacancy.create({
      data: {
        shelterId: ownerShelterId,
        wpPostId: 900851,
        title: 'Vaga Fixture E2E Fatia B',
        slug: 'vaga-fixture-e2e-data-b',
        status: 'active',
        isPublished: true,
        periodo: 'Matutino',
        cargaHoraria: '4h',
        cidade: 'Porto Alegre',
        estado: 'RS',
      },
    });
    fixtureVacancyId = fixtureVacancy.id;
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.vacancyApplication.deleteMany({
        where: { volunteerId },
      });
      await prisma.vacancy.deleteMany({
        where: {
          OR: [
            { id: fixtureVacancyId },
            ...(createdVacancyId ? [{ id: createdVacancyId }] : []),
          ],
        },
      });
      await prisma.volunteer.deleteMany({ where: { id: volunteerId } });
      await prisma.shelterHistory.deleteMany({
        where: {
          shelterId: {
            in: [ownerShelterId, otherShelterId, disabledShelterId],
          },
        },
      });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.shelter.deleteMany({
          where: {
            id: { in: [ownerShelterId, otherShelterId, disabledShelterId] },
          },
        });
      });
      await prisma.user.deleteMany({
        where: {
          id: {
            in: [
              ownerId,
              otherOwnerId,
              disabledId,
              volunteerUserId,
              wrongRoleId,
            ],
          },
        },
      });

      expect(await prisma.user.count()).toBe(baseline.users);
      expect(await prisma.shelter.count()).toBe(baseline.shelters);
      expect(await prisma.vacancy.count()).toBe(baseline.vacancies);
      expect(await prisma.volunteer.count()).toBe(baseline.volunteers);
      expect(await prisma.vacancyApplication.count()).toBe(
        baseline.applications,
      );
    }
    await app?.close();
  }, 60_000);

  it('requires authentication for shelter vacancy routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/vacancies').expect(401, {
      error: 'Não autenticado',
    });
  });

  it('rejects a role without a shelter and blocks disabled team writes', async () => {
    const wrongRoleAuth = await auth(
      wrongRoleId,
      EMAILS.wrongRole,
      'voluntario',
    );
    await request(app.getHttpServer())
      .post('/api/v1/vacancies')
      .set('Authorization', wrongRoleAuth)
      .send(VACANCY_BODY)
      .expect(404, { error: 'Abrigo não encontrado para o usuário.' });

    const disabledAuth = await auth(disabledId, EMAILS.disabled, 'abrigo', {
      isTeamOnly: true,
      teamDisabled: true,
    });
    await request(app.getHttpServer())
      .post('/api/v1/vacancies')
      .set('Authorization', disabledAuth)
      .send(VACANCY_BODY)
      .expect(403, { error: 'Acesso negado' });
  });

  it('creates, lists, resolves by slug UUID prefix and updates an owned vacancy', async () => {
    const ownerAuth = await auth(ownerId, EMAILS.owner, 'abrigo');
    const created = await request(app.getHttpServer())
      .post('/api/v1/vacancies')
      .set('Authorization', ownerAuth)
      .send(VACANCY_BODY)
      .expect(200);

    expect(created.body.vacancy).toMatchObject({
      title: VACANCY_BODY.post_title,
      city: 'Porto Alegre',
      state: 'RS',
      isPublished: true,
      source: 'supabase',
    });
    createdVacancyId = created.body.vacancy.id as string;
    createdVacancySlug = created.body.vacancy.slug as string;
    expect(createdVacancySlug).toMatch(
      new RegExp(`${createdVacancyId.replace(/-/g, '').slice(0, 8)}$`, 'i'),
    );

    const list = await request(app.getHttpServer())
      .get('/api/v1/vacancies')
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(list.body.vacancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdVacancyId, source: 'supabase' }),
      ]),
    );

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/vacancies/${createdVacancySlug}`)
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(detail.body.vacancy.id).toBe(createdVacancyId);

    const updated = await request(app.getHttpServer())
      .put(`/api/v1/vacancies/${createdVacancyId}`)
      .set('Authorization', ownerAuth)
      .send({ ...VACANCY_BODY, post_title: 'Vaga E2E Atualizada' })
      .expect(200);
    expect(updated.body.vacancy).toMatchObject({
      id: createdVacancyId,
      title: 'Vaga E2E Atualizada',
    });
  });

  it('does not expose another shelter vacancy through owned routes', async () => {
    const otherAuth = await auth(otherOwnerId, EMAILS.otherOwner, 'abrigo');
    await request(app.getHttpServer())
      .get(`/api/v1/vacancies/${fixtureVacancyId}`)
      .set('Authorization', otherAuth)
      .expect(404, { error: 'Vaga não encontrada' });
    await request(app.getHttpServer())
      .put(`/api/v1/vacancies/${fixtureVacancyId}`)
      .set('Authorization', otherAuth)
      .send(VACANCY_BODY)
      .expect(404, { error: 'Vaga não encontrada' });
    await request(app.getHttpServer())
      .delete(`/api/v1/vacancies/${fixtureVacancyId}`)
      .set('Authorization', otherAuth)
      .expect(404, { error: 'Vaga não encontrada ou sem permissão' });
  });

  it('serves public vacancy list and detail without a token', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/public/vacancies')
      .expect(200);
    expect(list.body.vacancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '900851',
          slug: 'vaga-fixture-e2e-data-b',
          period: 'manhã',
          workload: '4h',
          location: 'Porto Alegre - RS',
        }),
      ]),
    );

    const detail = await request(app.getHttpServer())
      .get('/api/v1/public/vacancies/vaga-fixture-e2e-data-b')
      .expect(200);
    expect(detail.body).toMatchObject({
      id: fixtureVacancyId,
      title: 'Vaga Fixture E2E Fatia B',
      source: 'supabase',
    });
  });

  it('applies, exposes my-status, rejects duplicates and returns application shape to the owner', async () => {
    const volunteerAuth = await auth(
      volunteerUserId,
      EMAILS.volunteer,
      'voluntario',
    );
    const application = await request(app.getHttpServer())
      .post(`/api/v1/vacancies/${fixtureVacancyId}/apply`)
      .set('Authorization', volunteerAuth)
      .expect(200);
    expect(application.body).toMatchObject({
      success: true,
      application: {
        vacancy_id: fixtureVacancyId,
        volunteer_id: volunteerId,
        status: 'pending',
      },
    });
    expect(application.body.application.applied_at).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get(`/api/v1/vacancies/${fixtureVacancyId}/my-status`)
      .set('Authorization', volunteerAuth)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toEqual({
          isOwner: false,
          hasApplied: true,
          threadId: expect.any(String),
          shelterProfileId: ownerId,
        }),
      );
    await request(app.getHttpServer())
      .get(`/api/v1/vacancies/${fixtureVacancyId}/my-status`)
      .expect(200, {
        isOwner: false,
        hasApplied: false,
        threadId: null,
        shelterProfileId: null,
      });

    await request(app.getHttpServer())
      .post(`/api/v1/vacancies/${fixtureVacancyId}/apply`)
      .set('Authorization', volunteerAuth)
      .expect(409, { error: 'Você já se candidatou a esta vaga' });

    const ownerAuth = await auth(ownerId, EMAILS.owner, 'abrigo');
    const applications = await request(app.getHttpServer())
      .get(`/api/v1/vacancies/${fixtureVacancyId}/applications`)
      .set('Authorization', ownerAuth)
      .expect(200);
    expect(applications.body.applications).toEqual([
      expect.objectContaining({
        id: application.body.application.id,
        status: 'pending',
        applied_at: expect.any(String),
        created_at: expect.any(String),
        volunteers: expect.objectContaining({
          id: volunteerId,
          name: 'Voluntário E2E Vagas',
          cidade: 'Porto Alegre',
          estado: 'RS',
          telefone: '51999999999',
          profissao: 'Cuidador',
          experiencia: 'Sim',
          slug: 'voluntario-e2e-vagas',
        }),
      }),
    ]);

    const otherAuth = await auth(otherOwnerId, EMAILS.otherOwner, 'abrigo');
    await request(app.getHttpServer())
      .get(`/api/v1/vacancies/${fixtureVacancyId}/applications`)
      .set('Authorization', otherAuth)
      .expect(404, { error: 'Vaga não encontrada ou sem permissão' });
  });

  it('deletes an owned vacancy', async () => {
    const ownerAuth = await auth(ownerId, EMAILS.owner, 'abrigo');
    await request(app.getHttpServer())
      .delete(`/api/v1/vacancies/${createdVacancyId}`)
      .set('Authorization', ownerAuth)
      .expect(200, {
        success: true,
        message: 'Vaga deletada com sucesso',
      });
    createdVacancyId = undefined;
    createdVacancySlug = undefined;
  });
});
