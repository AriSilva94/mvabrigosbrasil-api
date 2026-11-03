import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import bcrypt from 'bcryptjs';
import wordpressHash from 'wordpress-hash-node';
import cookieParser from 'cookie-parser';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { RedisService } from './../src/redis/redis.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { MailService } from './../src/mail/mail.service';

// Regressões da auditoria do fluxo de login (branch fix/login-security).
// Mesmas regras de `auth.e2e-spec.ts`: só e-mails sintéticos
// `e2e+sec...@test.local`, ids legados >= 910000 e limpeza exata no afterAll.
const NOOP_THROTTLER_STORAGE: ThrottlerStorage = {
  increment: () =>
    Promise.resolve({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
};

const EMAIL = (name: string) => `e2e+sec-${name}@test.local`;
const PASSWORD = 'SecAudit!2026';

function sessionCookies(setCookie: string | string[] | undefined): string[] {
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  return list.map((cookie) => cookie.split(';')[0]);
}

describe('Auth security regressions (E2E)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  // Recriado a cada teste: um teste que falha antes de restaurar o spy não
  // pode vazar um link de redefinição (de uma conta real) para o seguinte.
  let sendPasswordReset: jest.SpyInstance;

  const legacyIds: bigint[] = [];
  const postIds: bigint[] = [];
  const shelterWpPostIds: number[] = [];
  const emails: string[] = [];

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
  }, 60_000);

  beforeEach(() => {
    sendPasswordReset = jest
      .spyOn(app.get(MailService), 'sendPasswordReset')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    sendPasswordReset.mockRestore();
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true },
    });
    for (const { id } of users) {
      const sids = await redis.client.smembers(`user_sess:${id}`);
      for (const sid of sids) await redis.client.del(`sess:${sid}`);
      await redis.client.del(`user_sess:${id}`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`
        DELETE FROM shelters WHERE wp_post_id = ANY(${shelterWpPostIds})
      `;
    });
    await prisma.wpPostRaw.deleteMany({ where: { id: { in: postIds } } });
    await prisma.wpUserLegacy.deleteMany({ where: { id: { in: legacyIds } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  }, 60_000);

  async function createLegacyWithShelter(
    id: bigint,
    email: string,
  ): Promise<void> {
    legacyIds.push(id);
    postIds.push(id);
    shelterWpPostIds.push(Number(id));
    await prisma.wpUserLegacy.create({
      data: {
        id,
        userLogin: `e2esec${id}`,
        userEmail: email,
        userPass: wordpressHash.HashPassword('LegacyOwner!Pwd'),
        displayName: `E2E Sec ${id}`,
        migrated: false,
      },
    });
    await prisma.wpPostRaw.create({
      data: {
        id,
        postAuthor: id,
        postType: 'abrigo',
        postStatus: 'publish',
        postTitle: `E2E Sec Shelter ${id}`,
      },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`
        INSERT INTO shelters (id, name, wp_post_id, profile_id)
        VALUES (gen_random_uuid(), ${`E2E Sec Shelter ${id}`}, ${Number(id)}, NULL)
      `;
    });
  }

  async function createUser(
    email: string,
    role: 'abrigo' | 'voluntario' = 'abrigo',
  ): Promise<void> {
    emails.push(email);
    await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        role,
        emailVerified: true,
      },
    });
  }

  async function login(email: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return sessionCookies(res.headers['set-cookie']);
  }

  async function legacyState(id: bigint) {
    const [legacy, shelter] = await Promise.all([
      prisma.wpUserLegacy.findUnique({ where: { id } }),
      prisma.shelter.findUnique({ where: { wpPostId: Number(id) } }),
    ]);
    return { migrated: legacy?.migrated, profileId: shelter?.profileId };
  }

  describe('C1: privileged roles cannot be self-assigned', () => {
    it.each(['admin', 'gerente'])(
      'POST /auth/register with registerType=%s -> 400, no user created',
      async (registerType) => {
        const email = EMAIL(`c1-${registerType}`);
        emails.push(email);

        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/register')
          .send({ email, password: PASSWORD, registerType })
          .expect(400);

        expect(res.body).toEqual({ error: 'Tipo de cadastro inválido.' });
        expect(res.headers['set-cookie']).toBeUndefined();
        expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      },
    );

    it('a voluntario cannot create team accesses -> 403', async () => {
      const actor = EMAIL('c1-volunteer-actor');
      await createUser(actor, 'voluntario');
      const cookies = await login(actor);
      const email = EMAIL('c1-team-by-volunteer');
      emails.push(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Cookie', cookies)
        .send({ email, password: PASSWORD, teamOnly: true })
        .expect(403);
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    });

    it('a shelter owner creates team accesses always as abrigo', async () => {
      const actor = EMAIL('c1-shelter-actor');
      await createUser(actor, 'abrigo');
      const cookies = await login(actor);
      const email = EMAIL('c1-team-by-shelter');
      emails.push(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set('Cookie', cookies)
        .send({
          email,
          password: PASSWORD,
          teamOnly: true,
          registerType: 'voluntario',
        })
        .expect(200);

      const created = await prisma.user.findUnique({ where: { email } });
      expect(created).toMatchObject({ role: 'abrigo', isTeamOnly: true });
    });
  });

  describe('C2: e-mail lookups never treat % or _ as wildcards', () => {
    const legacyId = 910_001n;
    const legacyEmail = 'e2e+sec-c2xvictim@test.local';

    beforeAll(() => createLegacyWithShelter(legacyId, legacyEmail));

    it.each(['%', 'e2e+sec-c2%', 'e2e+sec-c2_victim@test.local'])(
      'login with %p does not match the legacy account',
      async (email) => {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'x' })
          .expect(401);
        // Sem curinga, nenhuma senha foi conferida contra o legado: se tivesse
        // casado, a migração lazy teria tentado (e o legado seguiria igual).
        expect(await legacyState(legacyId)).toEqual({
          migrated: false,
          profileId: null,
        });
      },
    );

    it('forgot-password with a wildcard e-mail sends nothing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: '%' })
        .expect(200);

      expect(sendPasswordReset).not.toHaveBeenCalled();
    });

    it('register rejects a wildcard e-mail -> 400', async () => {
      emails.push('%');
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: '%', password: PASSWORD })
        .expect(400);
    });

    it('a password reset for an "_" e-mail does not claim a look-alike legacy account', async () => {
      const email = 'e2e+sec-c2_victim@test.local';
      await createUser(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
      expect(sendPasswordReset).toHaveBeenCalledTimes(1);
      const [sentTo, link] = sendPasswordReset.mock.calls[0] as [
        string,
        string,
      ];
      expect(sentTo).toBe(email);
      const token = new URL(link).searchParams.get('token');

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'NewSecAudit!2026' })
        .expect(200);

      expect(await legacyState(legacyId)).toEqual({
        migrated: false,
        profileId: null,
      });
    });
  });

  describe('C3: nobody takes over a pending WordPress legacy account', () => {
    it('register with the e-mail of a pending legacy account -> 409', async () => {
      const legacyId = 910_002n;
      const email = EMAIL('c3-legacy');
      await createLegacyWithShelter(legacyId, email.toUpperCase());
      emails.push(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD })
        .expect(409);

      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
      expect(await legacyState(legacyId)).toEqual({
        migrated: false,
        profileId: null,
      });
    });

    it('change-password does not link a pending legacy account with the same e-mail', async () => {
      const legacyId = 910_003n;
      const email = EMAIL('c3-preexisting');
      await createLegacyWithShelter(legacyId, email);
      await createUser(email);
      const cookies = await login(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', cookies)
        .send({ currentPassword: PASSWORD, newPassword: 'Changed!2026' })
        .expect(200);

      expect(await legacyState(legacyId)).toEqual({
        migrated: false,
        profileId: null,
      });
    });

    it('the legacy owner logging in with the WordPress password revokes the squatter sessions', async () => {
      const legacyId = 910_004n;
      const email = EMAIL('c3-squatter');
      await createLegacyWithShelter(legacyId, email);
      await createUser(email);
      const squatter = await login(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'LegacyOwner!Pwd' })
        .expect(200);

      const refresh = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', squatter);
      expect(refresh.status).toBe(401);
    });
  });

  describe('C4: revoked sessions lose their access token immediately', () => {
    async function me(cookies: string[]) {
      return request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', cookies);
    }

    it('logout -> the same mv_at (cookie or Bearer) gets 401', async () => {
      const email = EMAIL('c4-logout');
      await createUser(email);
      const cookies = await login(email);
      const at = cookies.find((c) => c.startsWith('mv_at='))!.slice(6);
      expect((await me(cookies)).status).toBe(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookies)
        .expect(200);

      expect((await me(cookies)).status).toBe(401);
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${at}`)
        .expect(401);
    });

    it('change-password -> the other devices lose access, the current one keeps it', async () => {
      const email = EMAIL('c4-change');
      await createUser(email);
      const other = await login(email);
      const current = await login(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', current)
        .send({ currentPassword: PASSWORD, newPassword: 'Changed!2026' })
        .expect(200);

      expect((await me(other)).status).toBe(401);
      expect((await me(current)).status).toBe(200);
    });

    it('a revoked session also cannot act as team creator on the public register route', async () => {
      const email = EMAIL('c4-revoked-actor');
      await createUser(email);
      const cookies = await login(email);
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookies)
        .expect(200);
      const teamEmail = EMAIL('c4-team-by-revoked');
      emails.push(teamEmail);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .set(
          'Cookie',
          cookies.filter((c) => c.startsWith('mv_at=')),
        )
        .send({ email: teamEmail, password: PASSWORD, teamOnly: true })
        .expect(401);
    });
  });

  describe('C5: login does not reveal which e-mails have an account', () => {
    it('unknown e-mail and wrong password get the same status and body', async () => {
      const email = EMAIL('c5-existing');
      await createUser(email);

      const [unknown, wrong] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: EMAIL('c5-unknown'), password: 'Wrong!2026' }),
        request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'Wrong!2026' }),
      ]);

      expect(unknown.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect(unknown.body).toEqual(wrong.body);
    });
  });

  describe('C6: oversized passwords are rejected cheaply', () => {
    it('login with a 100 KB password -> 401 without hashing it', async () => {
      const started = Date.now();
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'e2e_sec-c2xvictim@test.local',
          password: 'a'.repeat(100_000),
        })
        .expect(401);
      expect(Date.now() - started).toBeLessThan(300);
    });

    it('register with a password over 72 bytes -> 400', async () => {
      const email = EMAIL('c6-long');
      emails.push(email);
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'a'.repeat(73) })
        .expect(400, { error: 'A senha deve ter no máximo 72 caracteres.' });
    });
  });

  describe('Low: password reset links', () => {
    async function requestLink(email: string): Promise<string> {
      sendPasswordReset.mockClear();
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email })
        .expect(200);
      const [, link] = sendPasswordReset.mock.calls[0] as [string, string];
      return new URL(link).searchParams.get('token')!;
    }

    it('the same link used twice concurrently succeeds only once', async () => {
      const email = EMAIL('low-race');
      await createUser(email);
      const token = await requestLink(email);

      const results = await Promise.all(
        [1, 2].map(() =>
          request(app.getHttpServer())
            .post('/api/v1/auth/reset-password')
            .send({ token, password: 'RaceReset!2026' }),
        ),
      );

      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    });

    it('a successful reset invalidates the other pending links', async () => {
      const email = EMAIL('low-pending');
      await createUser(email);
      const older = await requestLink(email);
      const newer = await requestLink(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: newer, password: 'NewerReset!2026' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: older, password: 'OlderReset!2026' })
        .expect(400);
    });

    it('change-password invalidates pending links', async () => {
      const email = EMAIL('low-change-links');
      await createUser(email);
      const token = await requestLink(email);
      const cookies = await login(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', cookies)
        .send({ currentPassword: PASSWORD, newPassword: 'Changed!2026' })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, password: 'Stolen!2026x' })
        .expect(400);
    });

    it('new passwords need at least 8 characters on every path', async () => {
      const email = EMAIL('low-min');
      await createUser(email);
      const token = await requestLink(email);

      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token, password: '1234567' })
        .expect(400, { error: 'A senha deve ter pelo menos 8 caracteres.' });
    });
  });

  describe('Low: disabled team members', () => {
    it('cannot read the owner dynamics after logging in again', async () => {
      const owner = EMAIL('low-team-owner');
      await createUser(owner);
      const ownerRow = await prisma.user.findUniqueOrThrow({
        where: { email: owner },
      });
      const member = EMAIL('low-team-member');
      emails.push(member);
      await prisma.user.create({
        data: {
          email: member,
          passwordHash: await bcrypt.hash(PASSWORD, 4),
          role: 'abrigo',
          isTeamOnly: true,
          teamDisabled: true,
          creatorProfileId: ownerRow.id,
        },
      });
      const cookies = await login(member);

      for (const path of ['/api/v1/dynamics', '/api/v1/dynamics/summary']) {
        await request(app.getHttpServer())
          .get(path)
          .set('Cookie', cookies)
          .expect(403);
      }
    });
  });

  describe('Low: cookie lifetime follows the configured TTLs', () => {
    it('mv_at and mv_rt Max-Age match AUTH_ACCESS_TTL and AUTH_REFRESH_TTL', async () => {
      const email = EMAIL('low-cookies');
      await createUser(email);
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const setCookie = res.headers['set-cookie'] as unknown as string[];

      expect(setCookie.find((c) => c.startsWith('mv_at='))).toContain(
        'Max-Age=900;',
      );
      expect(setCookie.find((c) => c.startsWith('mv_rt='))).toContain(
        'Max-Age=2592000;',
      );
    });
  });
});
