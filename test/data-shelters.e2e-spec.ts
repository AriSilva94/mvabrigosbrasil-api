/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Supertest exposes parsed JSON bodies as any; Jest assertions validate the wire contract here. */
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { TokenService, type Claims } from './../src/auth/jwt/token.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { RedisService } from './../src/redis/redis.service';
import {
  type PublicCacheSnapshot,
  restorePublicCache,
  snapshotPublicCache,
} from './helpers/public-cache';

const NOOP_THROTTLER_STORAGE: ThrottlerStorage = {
  increment: () =>
    Promise.resolve({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
};

const WP_POST_B = 990_102;
const WP_POST_DOCUMENT = 990_103;
const EMAILS = {
  ownerA: 'e2e+data-a-shelters-owner-a@test.local',
  ownerB: 'e2e+data-a-shelters-owner-b@test.local',
  document: 'e2e+data-a-shelters-document@test.local',
  admin: 'e2e+data-a-shelters-admin@test.local',
  volunteer: 'e2e+data-a-shelters-volunteer@test.local',
};

const validProfile = {
  shelterType: 'private',
  cnpj: '12.345.678/0001-90',
  shelterName: 'E2E Data A Abrigo A',
  cep: '90000-001',
  street: 'Rua Data A',
  number: 101,
  district: 'Centro',
  state: 'rs',
  city: 'Porto Alegre',
  website: 'https://data-a.test.local',
  foundationDate: '2020-01-02',
  species: 'Cães e gatos',
  additionalSpecies: [],
  temporaryAgreement: true,
  referralSource: 'Busca',
  initialDogs: 10,
  initialCats: 5,
  initialDogsLt: 2,
  initialCatsLt: 1,
  authorizedName: 'Responsável Data A',
  authorizedRole: 'Presidente',
  authorizedEmail: EMAILS.ownerA,
  authorizedPhone: '(51) 99999-0001',
  acceptTerms: true,
};

describe('Data domains E2E - shelters (slice A)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let tokenService: TokenService;
  let publicCacheSnapshot: PublicCacheSnapshot;
  let ownerAId: string;
  let ownerBId: string;
  let documentOwnerId: string;
  let adminId: string;
  let volunteerId: string;
  let shelterBId: string;
  let documentShelterId: string;
  let baseline: {
    users: number;
    shelters: number;
    history: number;
    dynamics: number;
    memberships: number;
  };

  const tokens: Record<string, string> = {};

  function claims(
    sub: string,
    email: string,
    role: Claims['role'],
    overrides: Partial<Claims> = {},
  ): Claims {
    return {
      sub,
      email,
      role,
      isTeamOnly: false,
      teamDisabled: false,
      creatorProfileId: null,
      sid: `data-a-shelters-${role ?? 'none'}-${sub}`,
      ...overrides,
    };
  }

  function authorized(token: string) {
    return [`mv_at=${token}`];
  }

  async function removeFixtures(): Promise<void> {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(EMAILS) } },
      select: { id: true },
    });
    const userIds = users.map(({ id }) => id);
    const shelters = await prisma.shelter.findMany({
      where: {
        OR: [
          { profileId: { in: userIds } },
          { wpPostId: { in: [WP_POST_B, WP_POST_DOCUMENT] } },
        ],
      },
      select: { id: true },
    });
    const shelterIds = shelters.map(({ id }) => id);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      if (shelterIds.length > 0) {
        await tx.vacancyApplication.deleteMany({
          where: { vacancy: { shelterId: { in: shelterIds } } },
        });
        await tx.vacancy.deleteMany({
          where: { shelterId: { in: shelterIds } },
        });
        await tx.shelterDynamics.deleteMany({
          where: { shelterId: { in: shelterIds } },
        });
        await tx.shelterHistory.deleteMany({
          where: { shelterId: { in: shelterIds } },
        });
        await tx.shelter.deleteMany({ where: { id: { in: shelterIds } } });
      }
      if (userIds.length > 0) {
        await tx.teamMembership.deleteMany({
          where: {
            OR: [
              { ownerProfileId: { in: userIds } },
              { memberProfileId: { in: userIds } },
            ],
          },
        });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
      }
    });
  }

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
    redis = app.get(RedisService);
    tokenService = app.get(TokenService);
    publicCacheSnapshot = await snapshotPublicCache(redis);
    await removeFixtures();

    baseline = {
      users: await prisma.user.count(),
      shelters: await prisma.shelter.count(),
      history: await prisma.shelterHistory.count(),
      dynamics: await prisma.shelterDynamics.count(),
      memberships: await prisma.teamMembership.count(),
    };

    const [ownerA, ownerB, documentOwner, admin, volunteer] = await Promise.all(
      [
        prisma.user.create({ data: { email: EMAILS.ownerA, role: 'abrigo' } }),
        prisma.user.create({ data: { email: EMAILS.ownerB, role: 'abrigo' } }),
        prisma.user.create({
          data: { email: EMAILS.document, role: 'abrigo' },
        }),
        prisma.user.create({ data: { email: EMAILS.admin, role: 'admin' } }),
        prisma.user.create({
          data: { email: EMAILS.volunteer, role: 'voluntario' },
        }),
      ],
    );
    ownerAId = ownerA.id;
    ownerBId = ownerB.id;
    documentOwnerId = documentOwner.id;
    adminId = admin.id;
    volunteerId = volunteer.id;

    const [shelterB, documentShelter] = await Promise.all([
      prisma.shelter.create({
        data: {
          profileId: ownerBId,
          wpPostId: WP_POST_B,
          name: 'E2E Data A Abrigo B',
          shelterType: 'private',
          cnpj: '98765432000110',
          cep: '90000001',
          street: 'Rua Data A',
          number: 202,
          district: 'Centro',
          state: 'RS',
          city: 'Porto Alegre',
          foundationDate: new Date('2019-01-01T00:00:00.000Z'),
          species: 'Cães',
          referralSource: 'Indicação',
          initialDogs: 4,
          initialCats: 3,
          authorizedName: 'Responsável B',
          authorizedRole: 'Diretor',
          authorizedEmail: EMAILS.ownerB,
          authorizedPhone: '51999990002',
          acceptTerms: true,
        },
      }),
      prisma.shelter.create({
        data: {
          profileId: documentOwnerId,
          wpPostId: WP_POST_DOCUMENT,
          name: 'E2E Data A Documento',
          shelterType: 'temporary',
          cpf: null,
          cnpj: null,
          cep: '90000003',
          street: 'Rua Documento',
          number: 303,
          district: 'Centro',
          state: 'RS',
          city: 'Porto Alegre',
          foundationDate: new Date('2018-01-01T00:00:00.000Z'),
          species: 'Gatos',
          referralSource: 'Evento',
          initialDogs: 1,
          initialCats: 2,
          authorizedName: 'Responsável Documento',
          authorizedRole: 'Tutor',
          authorizedEmail: EMAILS.document,
          authorizedPhone: '51999990003',
          acceptTerms: true,
        },
      }),
    ]);
    shelterBId = shelterB.id;
    documentShelterId = documentShelter.id;

    const signed = await Promise.all([
      tokenService.sign(claims(ownerAId, EMAILS.ownerA, 'abrigo')),
      tokenService.sign(claims(ownerBId, EMAILS.ownerB, 'abrigo')),
      tokenService.sign(claims(documentOwnerId, EMAILS.document, 'abrigo')),
      tokenService.sign(claims(adminId, EMAILS.admin, 'admin')),
      tokenService.sign(claims(volunteerId, EMAILS.volunteer, 'voluntario')),
      tokenService.sign(
        claims(ownerAId, EMAILS.ownerA, 'abrigo', { teamDisabled: true }),
      ),
    ]);
    [
      tokens.ownerA,
      tokens.ownerB,
      tokens.document,
      tokens.admin,
      tokens.volunteer,
      tokens.disabled,
    ] = signed;
  }, 60_000);

  afterAll(async () => {
    try {
      await removeFixtures();
      await restorePublicCache(redis, publicCacheSnapshot);

      expect(await prisma.user.count()).toBe(baseline.users);
      expect(await prisma.shelter.count()).toBe(baseline.shelters);
      expect(await prisma.shelterHistory.count()).toBe(baseline.history);
      expect(await prisma.shelterDynamics.count()).toBe(baseline.dynamics);
      expect(await prisma.teamMembership.count()).toBe(baseline.memberships);
      expect(
        await prisma.user.count({
          where: { email: { in: Object.values(EMAILS) } },
        }),
      ).toBe(0);
    } finally {
      await app?.close();
    }
  }, 60_000);

  it('requires a session and restricts the shelter list to admins', async () => {
    const unauthenticated = await request(app.getHttpServer())
      .get('/api/v1/shelters/me')
      .expect(401);
    expect(unauthenticated.body).toEqual({ error: 'Não autenticado' });

    const forbidden = await request(app.getHttpServer())
      .get('/api/v1/shelters')
      .set('Cookie', authorized(tokens.volunteer))
      .expect(403);
    expect(forbidden.body).toEqual({ error: 'Acesso negado' });

    const admin = await request(app.getHttpServer())
      .get('/api/v1/shelters')
      .set('Cookie', authorized(tokens.admin))
      .expect(200);
    expect(admin.body.shelters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: shelterBId,
          name: 'E2E Data A Abrigo B',
          wp_post_id: WP_POST_B,
        }),
      ]),
    );
  });

  it('returns null for an owner without a shelter and never exposes B', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/shelters/me')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200);

    expect(response.body).toEqual({ shelter: null });
    expect(JSON.stringify(response.body)).not.toContain('E2E Data A Abrigo B');
  });

  it('validates an absent profile and reports the document field explicitly', async () => {
    const absent = await request(app.getHttpServer())
      .get('/api/v1/profile/validate')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200);
    expect(absent.body).toMatchObject({
      isValid: false,
      requiresProfileUpdate: true,
      registerType: 'abrigo',
      profileExists: false,
    });
    expect(absent.body.missingFields).toContain('shelter_type');

    const missingDocument = await request(app.getHttpServer())
      .get('/api/v1/profile/validate')
      .set('Cookie', authorized(tokens.document))
      .expect(200);
    expect(missingDocument.body).toMatchObject({
      isValid: false,
      requiresProfileUpdate: true,
      registerType: 'abrigo',
      profileExists: true,
    });
    expect(missingDocument.body.missingFields).toEqual(['document']);
  });

  it('blocks shelter writes for a disabled team claim', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/shelters/me')
      .set('Cookie', authorized(tokens.disabled))
      .send(validProfile)
      .expect(403);

    expect(response.body).toEqual({ error: 'Acesso negado' });
    expect(
      await prisma.shelter.findUnique({ where: { profileId: ownerAId } }),
    ).toBeNull();
  });

  it('creates and reads the owner shelter with the literal profile shape', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/shelters/me')
      .set('Cookie', authorized(tokens.ownerA))
      .send(validProfile)
      .expect(200);

    expect(created.body).toEqual({
      ok: true,
      shelter: {
        shelterType: 'private',
        cnpj: '12345678000190',
        name: 'E2E Data A Abrigo A',
        cep: '90000001',
        street: 'Rua Data A',
        number: '101',
        district: 'Centro',
        state: 'RS',
        city: 'Porto Alegre',
        website: 'https://data-a.test.local',
        foundationDate: '2020-01-02',
        species: 'Cães e gatos',
        additionalSpecies: [],
        hasTemporaryAgreement: true,
        temporaryAgreement: true,
        referralSource: 'Busca',
        initialDogs: 10,
        initialCats: 5,
        initialDogsLt: 2,
        initialCatsLt: 1,
        authorizedName: 'Responsável Data A',
        authorizedRole: 'Presidente',
        authorizedEmail: EMAILS.ownerA,
        authorizedPhone: '51999990001',
        acceptTerms: true,
        active: true,
      },
    });

    const mine = await request(app.getHttpServer())
      .get('/api/v1/shelters/me')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200);
    expect(mine.body).toEqual({ shelter: created.body.shelter });
    expect(mine.body.shelter.name).not.toBe('E2E Data A Abrigo B');
  });

  it('does not create history when an identical profile is posted', async () => {
    const before = await request(app.getHttpServer())
      .get('/api/v1/shelters/me/history?limit=10&offset=0')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200);
    expect(before.body).toMatchObject({ limit: 10, offset: 0 });
    expect(before.body.history.length).toBeGreaterThan(0);

    await request(app.getHttpServer())
      .post('/api/v1/shelters/me')
      .set('Cookie', authorized(tokens.ownerA))
      .send(validProfile)
      .expect(200);

    const after = await request(app.getHttpServer())
      .get('/api/v1/shelters/me/history?limit=10&offset=0')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200);
    expect(after.body.total).toBe(before.body.total);
    expect(after.body.history).toEqual(before.body.history);
  });

  it('returns the deactivate contract and records status changes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/shelters/me/deactivate')
      .set('Cookie', authorized(tokens.admin))
      .expect(404, { error: 'Cadastro não encontrado' });

    await request(app.getHttpServer())
      .post('/api/v1/shelters/me/deactivate')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200, {
        ok: true,
        active: false,
        message: 'Cadastro inativado com sucesso',
      });

    const history = await request(app.getHttpServer())
      .get('/api/v1/shelters/me/history?limit=10&offset=0')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200);
    expect(history.body.history[0]).toMatchObject({
      operation: 'STATUS_CHANGE',
      changed_fields: ['active'],
    });

    await request(app.getHttpServer())
      .post('/api/v1/shelters/me/deactivate')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200, {
        ok: true,
        active: true,
        message: 'Cadastro reativado com sucesso',
      });
  });

  it('checks duplicate addresses while excluding the current owner', async () => {
    const missingCep = await request(app.getHttpServer())
      .get('/api/v1/shelters/check-address')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(400);
    expect(missingCep.body).toEqual({ error: 'CEP é obrigatório' });

    const duplicate = await request(app.getHttpServer())
      .get(
        '/api/v1/shelters/check-address?cep=90000-001&street=rua%20data%20a&number=202',
      )
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200);
    expect(duplicate.body).toEqual({
      exists: true,
      count: 1,
      shelters: [
        {
          name: 'E2E Data A Abrigo B',
          street: 'Rua Data A',
          number: 202,
          city: 'Porto Alegre',
          state: 'RS',
        },
      ],
    });
  });

  afterEach(async () => {
    expect(
      await prisma.shelter.findUnique({ where: { id: documentShelterId } }),
    ).not.toBeNull();
  });
});
