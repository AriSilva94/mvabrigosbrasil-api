/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Supertest exposes parsed JSON bodies as any; Jest assertions validate the wire contract here. */
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

const WP_POST_A = 990_201;
const WP_POST_B = 990_202;
const WP_USER_MANAGER = 990_203;
const EMAILS = {
  ownerA: 'e2e+data-a-dynamics-owner-a@test.local',
  ownerB: 'e2e+data-a-dynamics-owner-b@test.local',
  manager: 'e2e+data-a-dynamics-manager@test.local',
};

const validDynamics = {
  month: '09',
  year: '2099',
  dynamicType: 'dinamica',
  entries: 2,
  entriesCats: 1,
  adoptions: 1,
  adoptionsCats: 0,
  returns: 0,
  returnsCats: 0,
  euthanasias: 0,
  euthanasiasCats: 0,
  naturalDeaths: 0,
  naturalDeathsCats: 0,
  diseases: 1,
  diseasesCats: 0,
  tutorReturn: 0,
  tutorReturnCats: 0,
  originReturn: 0,
  originReturnCats: 0,
};

describe('Data domains E2E - dynamics (slice A)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let tokenService: TokenService;
  let publicCacheSnapshot: PublicCacheSnapshot;
  let ownerAId: string;
  let ownerBId: string;
  let managerId: string;
  let shelterAId: string;
  let shelterBId: string;
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
      sid: `data-a-dynamics-${role ?? 'none'}-${sub}`,
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
          { wpPostId: { in: [WP_POST_A, WP_POST_B] } },
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
      await tx.teamMembership.deleteMany({
        where: {
          OR: [
            { memberWpUserId: BigInt(WP_USER_MANAGER) },
            { memberProfileId: { in: userIds } },
            { abrigoPostId: { in: [BigInt(WP_POST_A), BigInt(WP_POST_B)] } },
          ],
        },
      });
      if (userIds.length > 0) {
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

    const [ownerA, ownerB, manager] = await Promise.all([
      prisma.user.create({
        data: {
          email: EMAILS.ownerA,
          fullName: 'Responsável Dinâmica A',
          role: 'abrigo',
        },
      }),
      prisma.user.create({ data: { email: EMAILS.ownerB, role: 'abrigo' } }),
      prisma.user.create({
        data: {
          email: EMAILS.manager,
          role: 'gerente',
          wpUserId: WP_USER_MANAGER,
        },
      }),
    ]);
    ownerAId = ownerA.id;
    ownerBId = ownerB.id;
    managerId = manager.id;

    const [shelterA, shelterB] = await Promise.all([
      prisma.shelter.create({
        data: {
          profileId: ownerAId,
          wpPostId: WP_POST_A,
          name: 'E2E Data A Dinâmica A',
          shelterType: 'private',
          initialDogs: 10,
          initialCats: 5,
          initialDogsLt: 2,
          initialCatsLt: 1,
          temporaryAgreement: true,
        },
      }),
      prisma.shelter.create({
        data: {
          profileId: ownerBId,
          wpPostId: WP_POST_B,
          name: 'E2E Data A Dinâmica B',
          shelterType: 'public',
          initialDogs: 3,
          initialCats: 4,
        },
      }),
    ]);
    shelterAId = shelterA.id;
    shelterBId = shelterB.id;

    await prisma.teamMembership.create({
      data: {
        memberProfileId: managerId,
        memberWpUserId: BigInt(WP_USER_MANAGER),
        memberEmail: EMAILS.manager,
        abrigoPostId: BigInt(WP_POST_A),
        role: 'manager',
        status: 'active',
      },
    });

    const signed = await Promise.all([
      tokenService.sign(claims(ownerAId, EMAILS.ownerA, 'abrigo')),
      tokenService.sign(claims(ownerBId, EMAILS.ownerB, 'abrigo')),
      tokenService.sign(claims(managerId, EMAILS.manager, 'gerente')),
      tokenService.sign(
        claims(ownerAId, EMAILS.ownerA, 'abrigo', { teamDisabled: true }),
      ),
    ]);
    [tokens.ownerA, tokens.ownerB, tokens.manager, tokens.disabled] = signed;
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

  it('requires a session for dynamics', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dynamics')
      .expect(401);
    expect(response.body).toEqual({ error: 'Não autenticado' });
  });

  it('returns both empty sections for an owner before any records exist', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/dynamics')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200);

    expect(response.body.sections).toHaveLength(2);
    expect(
      response.body.sections.map(
        (section: { dynamicType: string }) => section.dynamicType,
      ),
    ).toEqual(['dinamica', 'dinamica_lar']);
    expect(
      response.body.sections.every(
        (section: { rows: unknown[] }) => section.rows.length === 0,
      ),
    ).toBe(true);
  });

  it('rejects invalid payloads with details and blocks disabled writes', async () => {
    const invalid = await request(app.getHttpServer())
      .post('/api/v1/dynamics')
      .set('Cookie', authorized(tokens.ownerA))
      .send({ ...validDynamics, year: '99' })
      .expect(400);
    expect(invalid.body).toEqual({
      error: 'invalid_payload',
      details: {
        formErrors: [],
        fieldErrors: { year: ['Ano inválido'] },
      },
    });

    const disabledPost = await request(app.getHttpServer())
      .post('/api/v1/dynamics')
      .set('Cookie', authorized(tokens.disabled))
      .send(validDynamics)
      .expect(403);
    expect(disabledPost.body).toEqual({ error: 'Acesso negado' });

    const disabledDelete = await request(app.getHttpServer())
      .delete('/api/v1/dynamics')
      .set('Cookie', authorized(tokens.disabled))
      .send({ id: 'synthetic-id' })
      .expect(403);
    expect(disabledDelete.body).toEqual({ error: 'Acesso negado' });
  });

  it('creates a dynamics row and returns the documented display shape', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/dynamics')
      .set('Cookie', authorized(tokens.ownerA))
      .send(validDynamics)
      .expect(200);

    expect(response.body.sections).toHaveLength(2);
    const section = response.body.sections.find(
      ({ dynamicType }: { dynamicType: string }) => dynamicType === 'dinamica',
    );
    expect(section).toMatchObject({
      dynamicType: 'dinamica',
      title: 'Dinâmica Populacional',
      populationInitial: 15,
      populationCurrent: 17,
      populationInitialDogs: 10,
      populationInitialCats: 5,
      populationCurrentDogs: 11,
      populationCurrentCats: 6,
    });
    expect(section.stats).toHaveLength(5);
    expect(section.rows).toEqual([
      expect.objectContaining({
        referenceLabel: 'set/2099',
        referenceDate: '2099-09-01',
        balance: 2,
        cumulativeBalance: 17,
        metrics: expect.objectContaining({
          entriesDogs: 2,
          entriesCats: 1,
          adoptionsDogs: 1,
        }),
      }),
    ]);
  });

  it('scopes owner and manager reads to shelter A membership, never B', async () => {
    const ownerB = await request(app.getHttpServer())
      .get('/api/v1/dynamics')
      .set('Cookie', authorized(tokens.ownerB))
      .expect(200);
    expect(
      ownerB.body.sections.every(
        (section: { rows: unknown[] }) => section.rows.length === 0,
      ),
    ).toBe(true);

    const managerA = await request(app.getHttpServer())
      .get(`/api/v1/dynamics?shelter_id=${WP_POST_A}`)
      .set('Cookie', authorized(tokens.manager))
      .expect(200);
    expect(managerA.body.sections[0].rows).toHaveLength(1);

    const managerB = await request(app.getHttpServer())
      .get(`/api/v1/dynamics?shelter_id=${WP_POST_B}`)
      .set('Cookie', authorized(tokens.manager))
      .expect(200);
    expect(managerB.body).toEqual({ sections: [] });
  });

  it('returns owner and manager summaries without leaking shelter B', async () => {
    const owner = await request(app.getHttpServer())
      .get('/api/v1/dynamics/summary')
      .set('Cookie', authorized(tokens.ownerA))
      .expect(200);
    expect(owner.body).toEqual({
      summary: {
        displayName: 'Responsável Dinâmica A',
        totalAnimals: 15,
        shelterTypeLabel: 'Privado',
        hasTemporaryAgreement: true,
        dogsCount: 10,
        catsCount: 5,
        totalAnimalsLt: 3,
        dogsCountLt: 2,
        catsCountLt: 1,
      },
      shelterId: shelterAId,
    });

    const managerA = await request(app.getHttpServer())
      .get(`/api/v1/dynamics/summary?shelter_id=${WP_POST_A}`)
      .set('Cookie', authorized(tokens.manager))
      .expect(200);
    expect(managerA.body).toMatchObject({
      summary: { displayName: 'E2E Data A Dinâmica A', totalAnimals: 15 },
      shelterId: shelterAId,
    });

    const managerB = await request(app.getHttpServer())
      .get(`/api/v1/dynamics/summary?shelter_id=${WP_POST_B}`)
      .set('Cookie', authorized(tokens.manager))
      .expect(200);
    expect(managerB.body.shelterId).toBeNull();
    expect(managerB.body.summary.totalAnimals).toBeNull();
    expect(JSON.stringify(managerB.body)).not.toContain(shelterBId);
  });

  it('scopes DELETE by shelter before the owner removes the row', async () => {
    const row = await prisma.shelterDynamics.findUniqueOrThrow({
      where: {
        shelterId_dynamicType_referencePeriod: {
          shelterId: shelterAId,
          dynamicType: 'dinamica',
          referencePeriod: '2099-09',
        },
      },
    });

    await request(app.getHttpServer())
      .delete('/api/v1/dynamics')
      .set('Cookie', authorized(tokens.ownerB))
      .send({ id: row.id })
      .expect(200);
    expect(
      await prisma.shelterDynamics.findUnique({ where: { id: row.id } }),
    ).not.toBeNull();

    const removed = await request(app.getHttpServer())
      .delete('/api/v1/dynamics')
      .set('Cookie', authorized(tokens.ownerA))
      .send({ id: row.id })
      .expect(200);
    expect(removed.body.sections[0].rows).toEqual([]);
    expect(
      await prisma.shelterDynamics.findUnique({ where: { id: row.id } }),
    ).toBeNull();
  });
});
