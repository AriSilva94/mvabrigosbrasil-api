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
      'login with %p does not match the legacy account -> 404',
      async (email) => {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'x' })
          .expect(404);
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
});
