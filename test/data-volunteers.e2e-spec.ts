/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Supertest exposes parsed JSON bodies as any; Jest assertions validate the wire contract here. */
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
  volunteer: 'e2e+data-b-volunteers-main@test.local',
  disabled: 'e2e+data-b-volunteers-disabled@test.local',
  privateOwner: 'e2e+data-b-volunteers-private@test.local',
} as const;

const PROFILE_BODY = {
  name: 'Voluntária E2E Fatia B',
  telefone: '(51) 99999-1234',
  profissao: 'Médica veterinária',
  faixa_etaria: '30-39',
  genero: 'Feminino',
  escolaridade: 'Superior completo',
  estado: 'RS',
  cidade: 'Porto Alegre',
  disponibilidade: 'Semanal',
  periodo: 'Matutino',
  experiencia: 'Sim',
  atuacao: 'Presencial',
  descricao: 'Atendimento e cuidados veterinários.',
  comentarios: 'Fixture isolada da fatia B.',
  referralSource: 'Redes sociais',
  acceptTerms: true,
};

describe('Data domains E2E - volunteers (slice B)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenService: TokenService;
  let baseline: Record<'users' | 'volunteers', number>;
  let volunteerUserId: string;
  let disabledUserId: string;
  let privateOwnerId: string;
  let createdVolunteerId: string | undefined;
  let privateVolunteerId: string;

  const auth = async (
    sub: string,
    email: string,
    overrides: Partial<Claims> = {},
  ) => {
    const token = await tokenService.sign({
      sub,
      email,
      role: 'voluntario',
      isTeamOnly: false,
      teamDisabled: false,
      creatorProfileId: null,
      sid: `e2e-data-b-volunteers-${sub}`,
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
    tokenService = app.get(TokenService);
    baseline = {
      users: await prisma.user.count(),
      volunteers: await prisma.volunteer.count(),
    };

    const [volunteerUser, disabledUser, privateOwner] = await Promise.all([
      prisma.user.create({
        data: {
          email: EMAILS.volunteer,
          role: 'voluntario',
          wpUserId: 900861,
        },
      }),
      prisma.user.create({
        data: {
          email: EMAILS.disabled,
          role: 'voluntario',
          wpUserId: 900862,
          isTeamOnly: true,
          teamDisabled: true,
        },
      }),
      prisma.user.create({
        data: {
          email: EMAILS.privateOwner,
          role: 'voluntario',
          wpUserId: 900863,
        },
      }),
    ]);
    volunteerUserId = volunteerUser.id;
    disabledUserId = disabledUser.id;
    privateOwnerId = privateOwner.id;

    const privateVolunteer = await prisma.volunteer.create({
      data: {
        ownerProfileId: privateOwnerId,
        wpPostId: 900871,
        name: 'Voluntário Privado E2E Fatia B',
        slug: 'voluntario-privado-e2e-data-b',
        acceptTerms: true,
        isPublic: false,
      },
    });
    privateVolunteerId = privateVolunteer.id;
  }, 60_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.vacancyApplication.deleteMany({
        where: {
          volunteerId: {
            in: [
              privateVolunteerId,
              ...(createdVolunteerId ? [createdVolunteerId] : []),
            ],
          },
        },
      });
      await prisma.shelterVolunteer.deleteMany({
        where: {
          volunteerId: {
            in: [
              privateVolunteerId,
              ...(createdVolunteerId ? [createdVolunteerId] : []),
            ],
          },
        },
      });
      await prisma.volunteer.deleteMany({
        where: {
          id: {
            in: [
              privateVolunteerId,
              ...(createdVolunteerId ? [createdVolunteerId] : []),
            ],
          },
        },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [volunteerUserId, disabledUserId, privateOwnerId] },
        },
      });

      expect(await prisma.user.count()).toBe(baseline.users);
      expect(await prisma.volunteer.count()).toBe(baseline.volunteers);
    }
    await app?.close();
  }, 60_000);

  it('requires authentication for GET and POST /volunteers/me', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/volunteers/me')
      .expect(401, { error: 'Não autenticado' });
    await request(app.getHttpServer())
      .post('/api/v1/volunteers/me')
      .send(PROFILE_BODY)
      .expect(401, { error: 'Não autenticado' });
  });

  it('returns null before registration and blocks a disabled team write', async () => {
    const volunteerAuth = await auth(volunteerUserId, EMAILS.volunteer);
    await request(app.getHttpServer())
      .get('/api/v1/volunteers/me')
      .set('Authorization', volunteerAuth)
      .expect(200, { volunteer: null });

    const disabledAuth = await auth(disabledUserId, EMAILS.disabled, {
      isTeamOnly: true,
      teamDisabled: true,
    });
    await request(app.getHttpServer())
      .post('/api/v1/volunteers/me')
      .set('Authorization', disabledAuth)
      .send(PROFILE_BODY)
      .expect(403, { error: 'Acesso negado' });
  });

  it('creates the current profile and persists D4 referral_source/is_public', async () => {
    const volunteerAuth = await auth(volunteerUserId, EMAILS.volunteer);
    const response = await request(app.getHttpServer())
      .post('/api/v1/volunteers/me')
      .set('Authorization', volunteerAuth)
      .send(PROFILE_BODY)
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      volunteer: {
        name: PROFILE_BODY.name,
        telefone: '51999991234',
        profissao: PROFILE_BODY.profissao,
        faixa_etaria: PROFILE_BODY.faixa_etaria,
        genero: PROFILE_BODY.genero,
        escolaridade: PROFILE_BODY.escolaridade,
        estado: PROFILE_BODY.estado,
        cidade: PROFILE_BODY.cidade,
        disponibilidade: PROFILE_BODY.disponibilidade,
        periodo: PROFILE_BODY.periodo,
        experiencia: PROFILE_BODY.experiencia,
        atuacao: PROFILE_BODY.atuacao,
        descricao: PROFILE_BODY.descricao,
        comentarios: PROFILE_BODY.comentarios,
        referral_source: PROFILE_BODY.referralSource,
        acceptTerms: true,
        is_public: true,
      },
    });

    const row = await prisma.volunteer.findFirstOrThrow({
      where: { ownerProfileId: volunteerUserId },
    });
    createdVolunteerId = row.id;
    expect(row).toMatchObject({
      referralSource: PROFILE_BODY.referralSource,
      isPublic: true,
      acceptTerms: true,
    });
  });

  it('returns the current profile and performs a no-op save without updating the row', async () => {
    const volunteerAuth = await auth(volunteerUserId, EMAILS.volunteer);
    const before = await prisma.volunteer.findFirstOrThrow({
      where: { ownerProfileId: volunteerUserId },
    });

    const get = await request(app.getHttpServer())
      .get('/api/v1/volunteers/me')
      .set('Authorization', volunteerAuth)
      .expect(200);
    expect(get.body.volunteer).toMatchObject({
      name: PROFILE_BODY.name,
      referral_source: PROFILE_BODY.referralSource,
      is_public: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await request(app.getHttpServer())
      .post('/api/v1/volunteers/me')
      .set('Authorization', volunteerAuth)
      .send(PROFILE_BODY)
      .expect(200);

    const after = await prisma.volunteer.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    expect(
      await prisma.volunteer.count({
        where: { ownerProfileId: volunteerUserId },
      }),
    ).toBe(1);
  });

  it('creates a public profile that can be listed and opened by its generated card slug without a token', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/volunteers')
      .expect(200);
    const card = (list.body.volunteers as Array<Record<string, unknown>>).find(
      (item) => item.id === createdVolunteerId,
    );
    expect(card).toMatchObject({
      id: createdVolunteerId,
      name: PROFILE_BODY.name,
      city: 'Porto Alegre',
      state: 'RS',
      location: 'Porto Alegre - RS',
      source: 'new',
    });
    expect(card?.slug).toEqual(expect.any(String));

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/volunteers/${String(card?.slug)}`)
      .expect(200);
    expect(detail.body).toMatchObject({
      id: createdVolunteerId,
      name: PROFILE_BODY.name,
      slug: card?.slug,
      city: 'Porto Alegre',
      state: 'RS',
      profession: PROFILE_BODY.profissao,
      phone: '51999991234',
      email: EMAILS.volunteer,
      skills: PROFILE_BODY.descricao,
      source: 'new',
    });
  });

  it('returns 404 for a non-public volunteer while public routes remain token-free', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/volunteers')
      .expect(200)
      .expect((response) => {
        expect(response.body.volunteers).not.toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: privateVolunteerId }),
          ]),
        );
      });
    await request(app.getHttpServer())
      .get('/api/v1/volunteers/voluntario-privado-e2e-data-b')
      .expect(404, { error: 'Voluntário não encontrado' });
  });
});
