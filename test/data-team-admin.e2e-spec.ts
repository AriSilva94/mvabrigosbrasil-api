/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- Supertest exposes parsed JSON bodies as any; Jest assertions validate the wire contract here. */
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
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

type CookieJar = string[];

const PASSWORD = 'E2eDataC!Password';
const MANAGER_WP_USER_ID = 930001;
const EXISTING_SHELTER_WP_ID = 930101;

function extractCookie(
  setCookie: CookieJar | undefined,
  name: string,
): string | null {
  const raw = (setCookie ?? []).find((cookie) => cookie.startsWith(`${name}=`));
  return raw ? raw.split(';')[0].slice(name.length + 1) : null;
}

describe('Data domains E2E - team and admin (slice C)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let tokens: TokenService;

  const ids = {
    creator: randomUUID(),
    otherCreator: randomUUID(),
    teamMember: randomUUID(),
    otherTeamMember: randomUUID(),
    admin: randomUUID(),
    manager: randomUUID(),
    shelterOwnerA: randomUUID(),
    shelterOwnerB: randomUUID(),
    shelterA: randomUUID(),
    shelterB: randomUUID(),
  };

  let baseline: {
    users: number;
    shelters: number;
    memberships: number;
  };
  const sessionIds = new Set<string>();
  let publicCacheSnapshot: PublicCacheSnapshot;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
    tokens = app.get(TokenService);

    publicCacheSnapshot = await snapshotPublicCache(redis);

    baseline = {
      users: await prisma.user.count(),
      shelters: await prisma.shelter.count(),
      memberships: await prisma.teamMembership.count(),
    };

    const passwordHash = bcrypt.hashSync(PASSWORD, 10);
    await prisma.user.createMany({
      data: [
        {
          id: ids.creator,
          email: 'e2e+data-c-team-creator@test.local',
          passwordHash,
          role: 'abrigo',
        },
        {
          id: ids.otherCreator,
          email: 'e2e+data-c-team-other-creator@test.local',
          passwordHash,
          role: 'abrigo',
        },
        {
          id: ids.teamMember,
          email: 'e2e+data-c-team-member@test.local',
          passwordHash,
          role: 'abrigo',
          isTeamOnly: true,
          creatorProfileId: ids.creator,
        },
        {
          id: ids.otherTeamMember,
          email: 'e2e+data-c-team-other-member@test.local',
          passwordHash,
          role: 'abrigo',
          isTeamOnly: true,
          creatorProfileId: ids.otherCreator,
        },
        {
          id: ids.admin,
          email: 'e2e+data-c-admin@test.local',
          passwordHash,
          role: 'admin',
        },
        {
          id: ids.manager,
          email: 'e2e+data-c-manager@test.local',
          passwordHash,
          role: 'gerente',
          wpUserId: MANAGER_WP_USER_ID,
        },
        {
          id: ids.shelterOwnerA,
          email: 'e2e+data-c-shelter-owner-a@test.local',
          role: 'abrigo',
        },
        {
          id: ids.shelterOwnerB,
          email: 'e2e+data-c-shelter-owner-b@test.local',
          role: 'abrigo',
        },
      ],
    });

    await prisma.shelter.createMany({
      data: [
        {
          id: ids.shelterA,
          profileId: ids.shelterOwnerA,
          wpPostId: EXISTING_SHELTER_WP_ID,
          name: 'E2E Data C Shelter Existing',
          state: 'SC',
        },
        {
          id: ids.shelterB,
          profileId: ids.shelterOwnerB,
          name: 'E2E Data C Shelter Synthetic',
          state: 'RS',
        },
      ],
    });

    await prisma.teamMembership.create({
      data: {
        memberWpUserId: BigInt(MANAGER_WP_USER_ID),
        abrigoPostId: BigInt(EXISTING_SHELTER_WP_ID),
        role: 'manager',
        status: 'active',
      },
    });
  }, 60_000);

  afterAll(async () => {
    try {
      for (const sid of sessionIds) {
        await redis.client.del(`sess:${sid}`);
      }
      for (const userId of Object.values(ids).filter(
        (id) => id !== ids.shelterA && id !== ids.shelterB,
      )) {
        await redis.client.del(`user_sess:${userId}`);
      }
      await restorePublicCache(redis, publicCacheSnapshot);

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.teamMembership.deleteMany({
          where: { memberWpUserId: BigInt(MANAGER_WP_USER_ID) },
        });
        await tx.shelterHistory.deleteMany({
          where: { shelterId: { in: [ids.shelterA, ids.shelterB] } },
        });
        await tx.shelter.deleteMany({
          where: { id: { in: [ids.shelterA, ids.shelterB] } },
        });
        await tx.user.deleteMany({
          where: {
            id: {
              in: [
                ids.creator,
                ids.otherCreator,
                ids.teamMember,
                ids.otherTeamMember,
                ids.admin,
                ids.manager,
                ids.shelterOwnerA,
                ids.shelterOwnerB,
              ],
            },
          },
        });
      });

      expect(await prisma.teamMembership.count()).toBe(baseline.memberships);
      expect(await prisma.shelter.count()).toBe(baseline.shelters);
      expect(await prisma.user.count()).toBe(baseline.users);
    } finally {
      await app?.close();
    }
  }, 60_000);

  async function authCookie(
    userId: string,
    email: string,
    role: Claims['role'],
  ): Promise<string> {
    const accessToken = await tokens.sign({
      sub: userId,
      email,
      role,
      isTeamOnly: false,
      teamDisabled: false,
      creatorProfileId: null,
      sid: `e2e-data-c-${userId}`,
    });
    return `mv_at=${accessToken}`;
  }

  it('protects team routes and lists only team users owned by the creator', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/team/users')
      .expect(401)
      .expect({ error: 'Não autenticado' });

    const creatorCookie = await authCookie(
      ids.creator,
      'e2e+data-c-team-creator@test.local',
      'abrigo',
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/team/users')
      .set('Cookie', creatorCookie)
      .expect(200);

    expect(response.body.users).toEqual([
      expect.objectContaining({
        id: ids.teamMember,
        email: 'e2e+data-c-team-member@test.local',
        isDisabled: false,
        createdAt: expect.any(String),
      }),
    ]);
  });

  it('returns the literal 400/403 errors and toggles only an owned team user', async () => {
    const creatorCookie = await authCookie(
      ids.creator,
      'e2e+data-c-team-creator@test.local',
      'abrigo',
    );

    await request(app.getHttpServer())
      .post('/api/v1/team/users/toggle')
      .set('Cookie', creatorCookie)
      .send({ disable: true })
      .expect(400)
      .expect({ error: 'ID do usuário é obrigatório.' });

    await request(app.getHttpServer())
      .post('/api/v1/team/users/toggle')
      .set('Cookie', creatorCookie)
      .send({ userId: ids.otherTeamMember, disable: true })
      .expect(403)
      .expect({ error: 'Acesso negado para alterar este usuário.' });

    await request(app.getHttpServer())
      .post('/api/v1/team/users/toggle')
      .set('Cookie', creatorCookie)
      .send({ userId: ids.teamMember, disable: false })
      .expect(200)
      .expect({ ok: true });
  });

  it('disabling a team user revokes its real Redis session and refresh token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: 'e2e+data-c-team-member@test.local',
        password: PASSWORD,
      })
      .expect(200);
    const refreshCookie = extractCookie(
      login.headers['set-cookie'] as unknown as CookieJar,
      'mv_rt',
    );
    expect(refreshCookie).toBeTruthy();
    const sid = refreshCookie!.slice(0, refreshCookie!.indexOf('.'));
    sessionIds.add(sid);
    expect(await redis.client.get(`sess:${sid}`)).not.toBeNull();

    const creatorCookie = await authCookie(
      ids.creator,
      'e2e+data-c-team-creator@test.local',
      'abrigo',
    );
    await request(app.getHttpServer())
      .post('/api/v1/team/users/toggle')
      .set('Cookie', creatorCookie)
      .send({ userId: ids.teamMember, disable: true })
      .expect(200)
      .expect({ ok: true });

    expect(await redis.client.get(`sess:${sid}`)).toBeNull();
    expect(
      await redis.client.sismember(`user_sess:${ids.teamMember}`, sid),
    ).toBe(0);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `mv_rt=${refreshCookie}`)
      .expect(401)
      .expect({ error: 'Sessão expirada' });
  });

  it('enforces admin roles and returns the managers contract shape', async () => {
    const managerCookie = await authCookie(
      ids.manager,
      'e2e+data-c-manager@test.local',
      'gerente',
    );
    await request(app.getHttpServer())
      .get('/api/v1/admin/managers')
      .set('Cookie', managerCookie)
      .expect(403)
      .expect({ error: 'Acesso negado' });

    const adminCookie = await authCookie(
      ids.admin,
      'e2e+data-c-admin@test.local',
      'admin',
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/managers')
      .set('Cookie', adminCookie)
      .expect(200);
    const manager = response.body.managers.find(
      (item: { id: string }) => item.id === ids.manager,
    );
    expect(manager).toEqual({
      id: ids.manager,
      email: 'e2e+data-c-manager@test.local',
      created_at: expect.any(String),
      wp_user_id: MANAGER_WP_USER_ID,
      shelters: [
        {
          id: ids.shelterA,
          name: 'E2E Data C Shelter Existing',
          wp_post_id: EXISTING_SHELTER_WP_ID,
        },
      ],
    });
  });

  it('replaces manager shelters, assigns a negative synthetic id, and serves manager me', async () => {
    const adminCookie = await authCookie(
      ids.admin,
      'e2e+data-c-admin@test.local',
      'admin',
    );
    await request(app.getHttpServer())
      .put(`/api/v1/admin/managers/${ids.manager}/shelters`)
      .set('Cookie', adminCookie)
      .send({ shelter_ids: 'not-an-array' })
      .expect(400)
      .expect({ error: 'shelter_ids deve ser um array' });

    await request(app.getHttpServer())
      .put(`/api/v1/admin/managers/${ids.manager}/shelters`)
      .set('Cookie', adminCookie)
      .send({ shelter_ids: [ids.shelterA, ids.shelterB] })
      .expect(200)
      .expect({ success: true });

    const syntheticShelter = await prisma.shelter.findUniqueOrThrow({
      where: { id: ids.shelterB },
      select: { wpPostId: true },
    });
    expect(syntheticShelter.wpPostId).toBeLessThan(0);

    const managerCookie = await authCookie(
      ids.manager,
      'e2e+data-c-manager@test.local',
      'gerente',
    );
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/managers/me/shelters')
      .set('Cookie', managerCookie)
      .expect(200);

    expect(response.body.shelters).toEqual(
      expect.arrayContaining([
        {
          id: ids.shelterA,
          name: 'E2E Data C Shelter Existing',
          wp_post_id: EXISTING_SHELTER_WP_ID,
        },
        {
          id: ids.shelterB,
          name: 'E2E Data C Shelter Synthetic',
          wp_post_id: syntheticShelter.wpPostId,
        },
      ]),
    );
    expect(response.body.shelters).toHaveLength(2);
  });
});
