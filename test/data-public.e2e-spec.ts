/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Supertest exposes parsed JSON bodies as any; Jest assertions validate the wire contract here. */
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import { RedisService } from './../src/redis/redis.service';

type CacheSnapshot = {
  value: string | null;
  pttl: number;
  capturedAt: number;
};

const MAP_CACHE_KEY = 'cache:v1:public:map-statistics';
const DATASET_CACHE_KEY = 'cache:v1:public:database-dataset';
const PUBLIC_SHELTER_WP_ID = 940101;
const INACTIVE_SHELTER_WP_ID = 940102;

describe('Data domains E2E - public data (slice C)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;

  const ids = {
    publicOwner: randomUUID(),
    inactiveOwner: randomUUID(),
    publicShelter: randomUUID(),
    inactiveShelter: randomUUID(),
    dynamics: randomUUID(),
  };
  let baseline: { users: number; shelters: number; dynamics: number };
  let activeBaseline: Array<{
    state: string | null;
    shelterType: string | null;
  }>;
  let mapCacheSnapshot: CacheSnapshot;
  let datasetCacheSnapshot: CacheSnapshot;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(compression());
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    baseline = {
      users: await prisma.user.count(),
      shelters: await prisma.shelter.count(),
      dynamics: await prisma.shelterDynamics.count(),
    };
    activeBaseline = await prisma.shelter.findMany({
      where: { active: true },
      select: { state: true, shelterType: true },
    });
    mapCacheSnapshot = await snapshotCache(MAP_CACHE_KEY);
    datasetCacheSnapshot = await snapshotCache(DATASET_CACHE_KEY);
    await redis.client.del(MAP_CACHE_KEY, DATASET_CACHE_KEY);

    await prisma.user.createMany({
      data: [
        {
          id: ids.publicOwner,
          email: 'e2e+data-c-public-owner@test.local',
          role: 'abrigo',
        },
        {
          id: ids.inactiveOwner,
          email: 'e2e+data-c-public-inactive@test.local',
          role: 'abrigo',
        },
      ],
    });
    await prisma.shelter.createMany({
      data: [
        {
          id: ids.publicShelter,
          profileId: ids.publicOwner,
          wpPostId: PUBLIC_SHELTER_WP_ID,
          name: 'E2E Data C Public Shelter',
          state: 'zz',
          shelterType: 'public',
          active: true,
          createdAt: new Date('2026-01-15T12:00:00.000Z'),
        },
        {
          id: ids.inactiveShelter,
          profileId: ids.inactiveOwner,
          wpPostId: INACTIVE_SHELTER_WP_ID,
          name: 'E2E Data C Inactive Shelter',
          state: 'yy',
          shelterType: 'private',
          active: false,
          createdAt: new Date('2025-02-10T12:00:00.000Z'),
        },
      ],
    });
    await prisma.shelterDynamics.create({
      data: {
        id: ids.dynamics,
        shelterId: ids.publicShelter,
        wpPostId: 940201,
        kind: 'abrigo',
        dynamicType: 'dinamica',
        referenceDate: new Date('2026-03-01T00:00:00.000Z'),
        referencePeriod: '2026-03',
        entradasDeAnimais: 7,
        entradasDeGatos: 3,
        adocoesCaes: 2,
        adocoesGatos: 1,
        retornoDeCaes: 4,
        retornoDeGatos: 2,
      },
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await redis.client.del(MAP_CACHE_KEY, DATASET_CACHE_KEY);
      await restoreCache(MAP_CACHE_KEY, mapCacheSnapshot);
      await restoreCache(DATASET_CACHE_KEY, datasetCacheSnapshot);

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.shelterDynamics.deleteMany({ where: { id: ids.dynamics } });
        await tx.shelterHistory.deleteMany({
          where: {
            shelterId: {
              in: [ids.publicShelter, ids.inactiveShelter],
            },
          },
        });
        await tx.shelter.deleteMany({
          where: { id: { in: [ids.publicShelter, ids.inactiveShelter] } },
        });
        await tx.user.deleteMany({
          where: { id: { in: [ids.publicOwner, ids.inactiveOwner] } },
        });
      });

      expect(await prisma.shelterDynamics.count()).toBe(baseline.dynamics);
      expect(await prisma.shelter.count()).toBe(baseline.shelters);
      expect(await prisma.user.count()).toBe(baseline.users);
    } finally {
      await app?.close();
    }
  }, 60_000);

  async function snapshotCache(key: string): Promise<CacheSnapshot> {
    const [value, pttl] = await Promise.all([
      redis.client.get(key),
      redis.client.pttl(key),
    ]);
    return { value, pttl, capturedAt: Date.now() };
  }

  async function restoreCache(
    key: string,
    snapshot: CacheSnapshot,
  ): Promise<void> {
    if (snapshot.value === null) return;
    if (snapshot.pttl === -1) {
      await redis.client.set(key, snapshot.value);
      return;
    }
    const remaining = snapshot.pttl - (Date.now() - snapshot.capturedAt);
    if (remaining > 0) {
      await redis.client.set(key, snapshot.value, 'PX', remaining);
    }
  }

  function expectedMapStatistics() {
    const rows = [...activeBaseline, { state: 'zz', shelterType: 'public' }];
    const byState = new Map<string, number>();
    const byType = {
      total: 0,
      public: 0,
      private: 0,
      mixed: 0,
      temporary: 0,
    };
    for (const row of rows) {
      const state = row.state?.toUpperCase();
      if (state) byState.set(state, (byState.get(state) ?? 0) + 1);
      byType.total += 1;
      if (
        row.shelterType === 'public' ||
        row.shelterType === 'private' ||
        row.shelterType === 'mixed' ||
        row.shelterType === 'temporary'
      ) {
        byType[row.shelterType] += 1;
      }
    }
    return { byState, byType };
  }

  it('serves map statistics without a token, with dynamic counts and a cache hit', async () => {
    const expected = expectedMapStatistics();
    const first = await request(app.getHttpServer())
      .get('/api/v1/public/map-statistics')
      .expect(200);

    expect(first.body).toEqual({
      byState: expect.any(Array),
      byType: expected.byType,
    });
    expect(
      new Map<string, number>(
        first.body.byState.map((item: { state: string; count: number }) => [
          item.state,
          item.count,
        ]),
      ),
    ).toEqual(expected.byState);
    expect(await redis.client.ttl(MAP_CACHE_KEY)).toBeGreaterThan(0);

    await prisma.shelter.update({
      where: { id: ids.publicShelter },
      data: { state: 'xx', shelterType: 'private' },
    });
    const second = await request(app.getHttpServer())
      .get('/api/v1/public/map-statistics')
      .expect(200);
    expect(second.body).toEqual(first.body);
    await prisma.shelter.update({
      where: { id: ids.publicShelter },
      data: { state: 'zz', shelterType: 'public' },
    });
  });

  it('serves the database dataset without a token, with shapes, counts, and a cache hit', async () => {
    const first = await request(app.getHttpServer())
      .get('/api/v1/public/database-dataset')
      .expect(200);

    expect(first.body).toEqual({
      shelters: expect.any(Array),
      movements: expect.any(Array),
      years: expect.any(Array),
      states: expect.any(Array),
    });
    expect(first.body.shelters).toHaveLength(baseline.shelters + 2);
    expect(first.body.movements).toHaveLength(baseline.dynamics + 1);
    expect(first.body.shelters).toContainEqual({
      id: PUBLIC_SHELTER_WP_ID,
      title: 'E2E Data C Public Shelter',
      postDate: '2026-01-15T12:00:00.000Z',
      year: 2026,
      month: 1,
      state: 'ZZ',
      type: 'Público',
    });
    expect(first.body.shelters).toContainEqual(
      expect.objectContaining({
        id: INACTIVE_SHELTER_WP_ID,
        title: 'E2E Data C Inactive Shelter',
        state: 'YY',
        type: 'Privado',
      }),
    );
    expect(first.body.movements).toContainEqual(
      expect.objectContaining({
        postType: 'dinamica',
        year: 2026,
        month: 3,
        shelterId: PUBLIC_SHELTER_WP_ID,
        shelterState: 'ZZ',
        shelterType: 'Público',
        metrics: expect.objectContaining({
          entradas: 7,
          entradasGatos: 3,
          adocoes: 2,
          adocoesGatos: 1,
          retornoTutor: 6,
          retornoTutorGatos: 2,
        }),
      }),
    );
    expect(first.body.years).toContain(2026);
    expect(first.body.states).toEqual(expect.arrayContaining(['YY', 'ZZ']));
    expect(await redis.client.ttl(DATASET_CACHE_KEY)).toBeGreaterThan(0);

    await prisma.shelter.update({
      where: { id: ids.publicShelter },
      data: { name: 'E2E Data C Changed After Cache Fill' },
    });
    const second = await request(app.getHttpServer())
      .get('/api/v1/public/database-dataset')
      .expect(200);
    expect(second.body).toEqual(first.body);
    await prisma.shelter.update({
      where: { id: ids.publicShelter },
      data: { name: 'E2E Data C Public Shelter' },
    });
  });
});
