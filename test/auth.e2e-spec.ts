import { randomBytes, createHash, createHmac } from 'crypto';
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
import { refreshRotationGraceKey } from './../src/redis/session.keys';
import { TokenService } from './../src/auth/jwt/token.service';
import { AuthService } from './../src/auth/auth.service';
import { PasswordService } from './../src/auth/password/password.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { MailService } from './../src/mail/mail.service';

const NOOP_THROTTLER_STORAGE: ThrottlerStorage = {
  increment: () =>
    Promise.resolve({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function prepareWordpressPassword(pwd: string): string {
  const withoutSlashes = pwd.replace(/\\(.)/g, '$1');
  const escaped = withoutSlashes
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const hmac = createHmac('sha384', 'wp-sha384').update(escaped).digest();
  return Buffer.from(hmac).toString('base64');
}

function buildWpHash(password: string): string {
  const prepared = prepareWordpressPassword(password);
  const bcryptHash = bcrypt.hashSync(prepared, 10);
  return '$wp' + bcryptHash.replace('$2a$', '$2y$');
}

function buildPhpassHash(password: string): string {
  return wordpressHash.HashPassword(password);
}

function buildMd5Hash(password: string): string {
  return createHash('md5').update(password).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CookieJar = string[];

function extractCookie(
  setCookie: CookieJar | undefined,
  name: string,
): string | null {
  const raw = (setCookie ?? []).find((c) => c.startsWith(`${name}=`));
  if (!raw) return null;
  const value = raw.split(';')[0].slice(name.length + 1);
  return value;
}

describe('Auth E2E - 16 login edge cases (doc 03 §12)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: RedisService;
  let tokenService: TokenService;

  let baseline: {
    users: number;
    legacy: number;
    posts: number;
    shelters: number;
    volunteers: number;
  };

  const userIds: string[] = [];
  const legacyIds: bigint[] = [];
  const postIds: bigint[] = [];
  const shelterWpPostIds: number[] = [];
  const volunteerWpPostIds: number[] = [];
  const redisPwdResetKeys: string[] = [];

  const EMAIL = (caseNo: number, suffix = '') =>
    `e2e+case${caseNo}${suffix}@test.local`;

  function trackSession(sid: string, userId: string): void {
    if (!userIds.includes(userId)) userIds.push(userId);
    void sid;
  }

  beforeAll(async () => {
    baseline = {
      users: 0,
      legacy: 0,
      posts: 0,
      shelters: 0,
      volunteers: 0,
    };

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

    baseline.users = await prisma.user.count();
    baseline.legacy = await prisma.wpUserLegacy.count();
    baseline.posts = await prisma.wpPostRaw.count();
    baseline.shelters = await prisma.shelter.count();
    baseline.volunteers = await prisma.volunteer.count();

    await seedFixtures();
  }, 60_000);

  afterAll(async () => {
    await cleanupFixtures();

    expect(await prisma.user.count()).toBe(baseline.users);
    expect(await prisma.wpUserLegacy.count()).toBe(baseline.legacy);
    expect(await prisma.wpPostRaw.count()).toBe(baseline.posts);
    expect(await prisma.shelter.count()).toBe(baseline.shelters);
    expect(await prisma.volunteer.count()).toBe(baseline.volunteers);

    await app.close();
  }, 60_000);

  async function createUnlinkedShelter(
    name: string,
    wpPostId: number,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`
        INSERT INTO shelters (id, name, wp_post_id, profile_id)
        VALUES (gen_random_uuid(), ${name}, ${wpPostId}, NULL)
      `;
    });
  }

  async function deleteSheltersByWpPostId(wpPostIds: number[]): Promise<void> {
    if (wpPostIds.length === 0) return;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`
        DELETE FROM shelters WHERE wp_post_id = ANY(${wpPostIds})
      `;
    });
  }

  const CASE1_PW = 'Case1Legacy!Wp';
  const CASE2_PW = 'Case2Legacy!Phpass';
  const CASE3_PW = 'Case3Legacy!Md5';
  const CASE4_PW = 'Case4Legacy!Upper';
  const CASE5_PW = 'C&se5"Special\\Pwd';
  const CASE6_PW = 'Case6NativeBcrypt!';
  const CASE7_REAL_PW = 'Case7RealWpPass!';
  const CASE89_PW = 'Case9NewPassword!';
  const CASE89_OLD_WP_PW = 'Case8OldWpPassword!';
  const CASE11_PW = 'Case11Correct!';
  const CASE12_PW = 'Case12TeamOnly!';
  const CASE13_PW = 'Case13Refresh!';
  const CASE14_PW = 'Case14NewPass!';
  const CASE15_PW = 'Case15Spaces!';
  const CASE16_PW = 'Case16BothPosts!';

  async function seedFixtures(): Promise<void> {
    const legacy1Id = 900001n;
    legacyIds.push(legacy1Id);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacy1Id,
        userLogin: 'e2ecase1',
        userEmail: EMAIL(1),
        userPass: buildWpHash(CASE1_PW),
        displayName: 'E2E Case 1',
        migrated: false,
      },
    });
    const post1Id = 900001n;
    postIds.push(post1Id);
    await prisma.wpPostRaw.create({
      data: {
        id: post1Id,
        postAuthor: legacy1Id,
        postType: 'abrigo',
        postStatus: 'publish',
        postTitle: 'E2E Case 1 Shelter',
      },
    });
    await createUnlinkedShelter('E2E Case 1 Shelter', 900001);
    shelterWpPostIds.push(900001);

    const legacy2Id = 900002n;
    legacyIds.push(legacy2Id);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacy2Id,
        userLogin: 'e2ecase2',
        userEmail: EMAIL(2),
        userPass: buildPhpassHash(CASE2_PW),
        displayName: 'E2E Case 2',
        migrated: false,
      },
    });

    const legacy3Id = 900003n;
    legacyIds.push(legacy3Id);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacy3Id,
        userLogin: 'e2ecase3',
        userEmail: EMAIL(3),
        userPass: buildMd5Hash(CASE3_PW),
        displayName: 'E2E Case 3',
        migrated: false,
      },
    });

    const legacy4Id = 900004n;
    legacyIds.push(legacy4Id);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacy4Id,
        userLogin: 'e2ecase4',
        userEmail: `E2E+Case4@Test.Local`,
        userPass: buildMd5Hash(CASE4_PW),
        displayName: 'E2E Case 4',
        migrated: false,
      },
    });

    const legacy5Id = 900005n;
    legacyIds.push(legacy5Id);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacy5Id,
        userLogin: 'e2ecase5',
        userEmail: EMAIL(5),
        userPass: buildWpHash(CASE5_PW),
        displayName: 'E2E Case 5',
        migrated: false,
      },
    });

    const user6 = await prisma.user.create({
      data: {
        email: EMAIL(6),
        passwordHash: bcrypt.hashSync(CASE6_PW, 10),
        emailVerified: true,
        origin: 'supabase_native',
        role: 'voluntario',
      },
    });
    userIds.push(user6.id);

    const user7 = await prisma.user.create({
      data: {
        email: EMAIL(7),
        passwordHash: bcrypt.hashSync(randomBytes(16).toString('hex'), 10),
        emailVerified: true,
        origin: 'wordpress_migrated',
      },
    });
    userIds.push(user7.id);
    const legacy7Id = 900007n;
    legacyIds.push(legacy7Id);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacy7Id,
        userLogin: 'e2ecase7',
        userEmail: EMAIL(7),
        userPass: buildWpHash(CASE7_REAL_PW),
        displayName: 'E2E Case 7',
        migrated: false,
      },
    });

    const user89 = await prisma.user.create({
      data: {
        email: EMAIL(8),
        passwordHash: bcrypt.hashSync(CASE89_PW, 10),
        emailVerified: true,
        origin: 'wordpress_migrated',
      },
    });
    userIds.push(user89.id);
    const legacy89Id = 900008n;
    legacyIds.push(legacy89Id);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacy89Id,
        userLogin: 'e2ecase89',
        userEmail: EMAIL(8),
        userPass: buildMd5Hash(CASE89_OLD_WP_PW),
        displayName: 'E2E Case 8/9',
        migrated: true,
        migratedAt: new Date(),
      },
    });

    const user11 = await prisma.user.create({
      data: {
        email: EMAIL(11),
        passwordHash: bcrypt.hashSync(CASE11_PW, 10),
        emailVerified: true,
        origin: 'supabase_native',
        role: 'abrigo',
      },
    });
    userIds.push(user11.id);

    const user12 = await prisma.user.create({
      data: {
        email: EMAIL(12),
        passwordHash: bcrypt.hashSync(CASE12_PW, 10),
        emailVerified: true,
        origin: 'admin_created',
        isTeamOnly: true,
        teamDisabled: true,
        role: 'abrigo',
      },
    });
    userIds.push(user12.id);

    const user13 = await prisma.user.create({
      data: {
        email: EMAIL(13),
        passwordHash: bcrypt.hashSync(CASE13_PW, 10),
        emailVerified: true,
        origin: 'supabase_native',
        role: 'voluntario',
      },
    });
    userIds.push(user13.id);

    const user14 = await prisma.user.create({
      data: {
        email: EMAIL(14),
        passwordHash: bcrypt.hashSync('irrelevant-original-pw', 10),
        emailVerified: true,
        origin: 'supabase_native',
      },
    });
    userIds.push(user14.id);

    const user15 = await prisma.user.create({
      data: {
        email: EMAIL(15),
        passwordHash: bcrypt.hashSync(CASE15_PW.trim(), 10),
        emailVerified: true,
        origin: 'supabase_native',
        role: 'voluntario',
      },
    });
    userIds.push(user15.id);

    const legacy16Id = 900016n;
    legacyIds.push(legacy16Id);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacy16Id,
        userLogin: 'e2ecase16',
        userEmail: EMAIL(16),
        userPass: buildMd5Hash(CASE16_PW),
        displayName: 'E2E Case 16',
        migrated: false,
      },
    });
    const post16AbrigoId = 900161n;
    const post16VoluntarioId = 900162n;
    postIds.push(post16AbrigoId, post16VoluntarioId);
    await prisma.wpPostRaw.create({
      data: {
        id: post16AbrigoId,
        postAuthor: legacy16Id,
        postType: 'abrigo',
        postStatus: 'publish',
        postTitle: 'E2E Case 16 Shelter',
      },
    });
    await prisma.wpPostRaw.create({
      data: {
        id: post16VoluntarioId,
        postAuthor: legacy16Id,
        postType: 'voluntario',
        postStatus: 'publish',
        postTitle: 'E2E Case 16 Volunteer',
      },
    });
    await createUnlinkedShelter('E2E Case 16 Shelter', 900161);
    shelterWpPostIds.push(900161);
    await prisma.volunteer.create({
      data: {
        name: 'E2E Case 16 Volunteer',
        wpPostId: 900162,
        ownerProfileId: null,
      },
    });
    volunteerWpPostIds.push(900162);
  }

  async function cleanupFixtures(): Promise<void> {
    for (const userId of userIds) {
      const sids = await redis.client.smembers(`user_sess:${userId}`);
      if (sids.length > 0) {
        const multi = redis.client.multi();
        for (const sid of sids) multi.del(`sess:${sid}`);
        multi.del(`user_sess:${userId}`);
        await multi.exec();
      }
    }
    for (const key of redisPwdResetKeys) {
      await redis.client.del(key);
    }

    if (volunteerWpPostIds.length > 0) {
      await prisma.volunteer.deleteMany({
        where: { wpPostId: { in: volunteerWpPostIds } },
      });
    }
    await deleteSheltersByWpPostId(shelterWpPostIds);
    if (postIds.length > 0) {
      await prisma.wpPostRaw.deleteMany({ where: { id: { in: postIds } } });
    }
    if (legacyIds.length > 0) {
      await prisma.wpUserLegacy.deleteMany({
        where: { id: { in: legacyIds } },
      });
    }
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e+', endsWith: '@test.local' } },
    });
  }

  it('Case 1: legacy $wp never logged in -> migrates, links shelter, migrated:false', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(1), password: CASE1_PW })
      .expect(200);

    expect(res.body).toEqual({ ok: true, migrated: false, postType: 'abrigo' });

    const setCookie = res.headers['set-cookie'] as unknown as CookieJar;
    expect(extractCookie(setCookie, 'mv_at')).toBeTruthy();
    expect(extractCookie(setCookie, 'mv_rt')).toBeTruthy();

    const user = await prisma.user.findUnique({ where: { email: EMAIL(1) } });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(user!.wpUserId).toBe(900001);
    if (user) userIds.push(user.id);

    const shelter = await prisma.shelter.findUnique({
      where: { wpPostId: 900001 },
    });
    expect(shelter?.profileId).toBe(user!.id);

    const legacy = await prisma.wpUserLegacy.findUnique({
      where: { id: 900001n },
    });
    expect(legacy?.migrated).toBe(true);
  });

  it('Case 2: legacy phpass $P$ never logged in -> migrates, migrated:false', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(2), password: CASE2_PW })
      .expect(200);

    expect(res.body).toEqual({ ok: true, migrated: false, postType: null });

    const user = await prisma.user.findUnique({ where: { email: EMAIL(2) } });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$/);
    if (user) userIds.push(user.id);

    const legacy = await prisma.wpUserLegacy.findUnique({
      where: { id: 900002n },
    });
    expect(legacy?.migrated).toBe(true);
  });

  it('Case 3: legacy md5 never logged in -> migrates, does NOT rewrite wp_users_legacy.user_pass', async () => {
    const originalHash = buildMd5Hash(CASE3_PW);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(3), password: CASE3_PW })
      .expect(200);

    expect(res.body).toEqual({ ok: true, migrated: false, postType: null });

    const user = await prisma.user.findUnique({ where: { email: EMAIL(3) } });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toMatch(/^\$2[aby]\$/);
    if (user) userIds.push(user.id);

    const legacy = await prisma.wpUserLegacy.findUnique({
      where: { id: 900003n },
    });
    expect(legacy?.migrated).toBe(true);
    expect(legacy?.userPass).toBe(originalHash);
  });

  it('Case 4: legacy e-mail with uppercase -> case-insensitive lookup, users.email stored lowercase', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(4), password: CASE4_PW })
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, migrated: false });

    const user = await prisma.user.findUnique({ where: { email: EMAIL(4) } });
    expect(user).not.toBeNull();
    expect(user!.email).toBe(EMAIL(4));
    if (user) userIds.push(user.id);
  });

  it('Case 5: legacy password with &, ", \\ validates via prepareWordpressPassword', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(5), password: CASE5_PW })
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, migrated: false });

    const user = await prisma.user.findUnique({ where: { email: EMAIL(5) } });
    expect(user).not.toBeNull();
    if (user) userIds.push(user.id);
  });

  it('Case 6: GoTrue-imported bcrypt account logs in without rehash', async () => {
    const before = await prisma.user.findUnique({ where: { email: EMAIL(6) } });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(6), password: CASE6_PW })
      .expect(200);

    expect(res.body).toEqual({
      ok: true,
      migrated: true,
      postType: 'voluntario',
    });

    const after = await prisma.user.findUnique({ where: { email: EMAIL(6) } });
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it('Case 7: disposable-password account + unmigrated legacy -> R1 fails, R2 verifies WP, overwrites passwordHash', async () => {
    const before = await prisma.user.findUnique({ where: { email: EMAIL(7) } });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(7), password: CASE7_REAL_PW })
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, migrated: false });

    const after = await prisma.user.findUnique({ where: { email: EMAIL(7) } });
    expect(after!.id).toBe(before!.id);
    expect(after!.passwordHash).not.toBe(before!.passwordHash);
    expect(bcrypt.compareSync(CASE7_REAL_PW, after!.passwordHash!)).toBe(true);

    const legacy = await prisma.wpUserLegacy.findUnique({
      where: { id: 900007n },
    });
    expect(legacy?.migrated).toBe(true);
  });

  it('Case 8: legacy migrated=true, old WP password -> 401 (user_pass not re-consulted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(8), password: CASE89_OLD_WP_PW })
      .expect(401);

    expect(res.body).toEqual({ error: 'E-mail ou senha inválidos.' });
  });

  it('Case 9: legacy migrated=true, new password -> 200 via R1', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(8), password: CASE89_PW })
      .expect(200);

    expect(res.body).toEqual({ ok: true, migrated: true, postType: null });
  });

  it('Case 10: e-mail in neither table -> same 401 as a wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(10), password: 'whatever-not-registered' })
      .expect(401);

    expect(res.body).toEqual({ error: 'E-mail ou senha inválidos.' });
  });

  it('Case 11: wrong password, user exists -> 401 generic error', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(11), password: 'totally-wrong-password' })
      .expect(401);

    expect(res.body).toEqual({ error: 'E-mail ou senha inválidos.' });
  });

  it('Case 12: team-only disabled -> login OK, claims teamDisabled:true', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(12), password: CASE12_PW })
      .expect(200);

    expect(res.body).toEqual({ ok: true, migrated: true, postType: 'abrigo' });

    const setCookie = res.headers['set-cookie'] as unknown as CookieJar;
    const at = extractCookie(setCookie, 'mv_at');
    expect(at).toBeTruthy();
    const claims = await tokenService.verify(at!);
    expect(claims?.teamDisabled).toBe(true);
    expect(claims?.isTeamOnly).toBe(true);
  });

  it('Case 13: concurrent refreshes converge, then reuse outside grace revokes', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(13), password: CASE13_PW })
      .expect(200);

    const loginCookies = loginRes.headers['set-cookie'] as unknown as CookieJar;
    const rt1 = extractCookie(loginCookies, 'mv_rt');
    expect(rt1).toBeTruthy();
    const sid = rt1!.split('.')[0];

    const user13 = await prisma.user.findUnique({
      where: { email: EMAIL(13) },
    });
    trackSession(sid, user13!.id);

    const [refresh1, refresh2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`mv_rt=${rt1}`])
        .expect(200),
      request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', [`mv_rt=${rt1}`])
        .expect(200),
    ]);
    expect(refresh1.body).toEqual({ ok: true });
    expect(refresh2.body).toEqual({ ok: true });
    const refresh1Cookies = refresh1.headers[
      'set-cookie'
    ] as unknown as CookieJar;
    const refresh2Cookies = refresh2.headers[
      'set-cookie'
    ] as unknown as CookieJar;
    const rt2 = extractCookie(refresh1Cookies, 'mv_rt');
    const duplicateRt2 = extractCookie(refresh2Cookies, 'mv_rt');
    expect(rt2).toBeTruthy();
    expect(rt2).not.toBe(rt1);
    expect(duplicateRt2).toBe(rt2);

    const refresh3 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`mv_rt=${rt2}`])
      .expect(200);
    const rt3 = extractCookie(
      refresh3.headers['set-cookie'] as unknown as CookieJar,
      'mv_rt',
    );
    expect(rt3).toBeTruthy();

    const rt1Token = rt1!.slice(rt1!.indexOf('.') + 1);
    const rt2Token = rt2!.slice(rt2!.indexOf('.') + 1);
    await redis.client.del(
      refreshRotationGraceKey(sid, sha256(rt1Token)),
      refreshRotationGraceKey(sid, sha256(rt2Token)),
    );

    const outsideGraceReuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`mv_rt=${rt2}`])
      .expect(401);
    expect(outsideGraceReuse.body).toEqual({ error: 'Sessão expirada' });

    const sessionAfter = await redis.client.get(`sess:${sid}`);
    expect(sessionAfter).toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`mv_rt=${rt3}`])
      .expect(401);
  });

  it('Case 14: reset with an expired token -> 400', async () => {
    const user14 = await prisma.user.findUnique({
      where: { email: EMAIL(14) },
    });
    expect(user14).not.toBeNull();

    const token = randomBytes(32).toString('base64url');
    const key = `pwdreset:${sha256(token)}`;
    redisPwdResetKeys.push(key);
    await redis.client.set(key, user14!.id, 'PX', 20);
    await sleep(100);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, password: CASE14_PW })
      .expect(400);

    expect(res.body).toEqual({ error: 'Link inválido ou expirado' });
  });

  it('Case 15: password with leading/trailing spaces is trimmed', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `  ${EMAIL(15)}  `, password: `  ${CASE15_PW}  ` })
      .expect(200);

    expect(res.body).toEqual({
      ok: true,
      migrated: true,
      postType: 'voluntario',
    });
  });

  it.each(['reset', 'change'] as const)(
    '%s keeps pending shelter/volunteer links reachable only by the e-mail owner',
    async (operation) => {
      const caseNo = operation === 'reset' ? 17 : 18;
      const legacyId = BigInt(900000 + caseNo);
      const shelterPostId = 900000 + caseNo * 10;
      const volunteerPostId = shelterPostId + 1;
      const email = EMAIL(caseNo);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash: await bcrypt.hash('CurrentPassword123', 4),
          emailVerified: true,
        },
      });
      userIds.push(user.id);
      legacyIds.push(legacyId);
      await prisma.wpUserLegacy.create({
        data: {
          id: legacyId,
          userLogin: `case${caseNo}`,
          userEmail: email,
          userPass: buildMd5Hash('OldWordPress123'),
          migrated: false,
        },
      });
      for (const [id, postType] of [
        [shelterPostId, 'abrigo'],
        [volunteerPostId, 'voluntario'],
      ] as const) {
        postIds.push(BigInt(id));
        await prisma.wpPostRaw.create({
          data: {
            id: BigInt(id),
            postAuthor: legacyId,
            postType,
            postStatus: 'publish',
          },
        });
      }
      shelterWpPostIds.push(shelterPostId);
      volunteerWpPostIds.push(volunteerPostId);
      await createUnlinkedShelter(`Case ${caseNo}`, shelterPostId);
      await prisma.volunteer.create({
        data: { wpPostId: volunteerPostId, name: `Case ${caseNo}` },
      });

      const previous = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'CurrentPassword123' })
        .expect(200);
      if (operation === 'reset') {
        const token = randomBytes(32).toString('base64url');
        const key = `pwdreset:${sha256(token)}`;
        redisPwdResetKeys.push(key);
        await redis.client.set(key, user.id, 'EX', 60);
        await request(app.getHttpServer())
          .post('/api/v1/auth/reset-password')
          .send({ token, password: 'NewPassword123' })
          .expect(200);
      } else {
        await request(app.getHttpServer())
          .post('/api/v1/auth/change-password')
          .set('Cookie', previous.headers['set-cookie'] as unknown as string[])
          .send({
            currentPassword: 'CurrentPassword123',
            newPassword: 'NewPassword123',
          })
          .expect(200);

        expect(
          (await prisma.wpUserLegacy.findUnique({ where: { id: legacyId } }))
            ?.migrated,
        ).toBe(false);
        expect(
          (
            await prisma.shelter.findUnique({
              where: { wpPostId: shelterPostId },
            })
          )?.profileId,
        ).toBeNull();
      }
      if (operation === 'reset') {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'OldWordPress123' })
          .expect(401);
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'NewPassword123' })
          .expect(200);
      } else {
        await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: 'OldWordPress123' })
          .expect(200);
      }
      expect(
        (await prisma.wpUserLegacy.findUnique({ where: { id: legacyId } }))
          ?.migrated,
      ).toBe(true);
      expect(
        (
          await prisma.shelter.findUnique({
            where: { wpPostId: shelterPostId },
          })
        )?.profileId,
      ).toBe(user.id);
      expect(
        (
          await prisma.volunteer.findUnique({
            where: { wpPostId: volunteerPostId },
          })
        )?.ownerProfileId,
      ).toBe(user.id);
      expect(
        (await prisma.user.findUnique({ where: { id: user.id } }))?.wpUserId,
      ).toBe(Number(legacyId));
    },
  );

  it('rejects a stale rehash if a password reset completes while bcrypt is running', async () => {
    const user = await prisma.user.create({
      data: { email: EMAIL(19), passwordHash: buildMd5Hash('OldPassword123') },
    });
    userIds.push(user.id);
    const passwords = app.get(PasswordService);
    const originalHash = passwords.hash.bind(
      passwords,
    ) as PasswordService['hash'];
    let resume!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const spy = jest
      .spyOn(passwords, 'hash')
      .mockImplementation(async (plain) => {
        if (plain === 'OldPassword123') {
          started();
          await blocked;
        }
        return originalHash(plain);
      });
    const auth = app.get(AuthService);
    const pending = auth.login(user.email, 'OldPassword123');
    const outcome = pending.then(
      () => 200,
      (error: unknown) => (error as { status: number }).status,
    );
    try {
      await entered;
      const token = randomBytes(32).toString('base64url');
      const key = `pwdreset:${sha256(token)}`;
      redisPwdResetKeys.push(key);
      await redis.client.set(key, user.id, 'EX', 60);
      await auth.resetPassword(token, 'NewPassword123');
      resume();
      expect(await outcome).toBe(401);
      const saved = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(await bcrypt.compare('NewPassword123', saved.passwordHash!)).toBe(
        true,
      );
    } finally {
      resume();
      await outcome;
      spy.mockRestore();
    }
  });

  it('Case 16: legacy has BOTH abrigo and voluntario posts -> links both', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(16), password: CASE16_PW })
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, migrated: false });
    expect(['abrigo', 'voluntario']).toContain(
      (res.body as { postType?: string }).postType,
    );

    const user = await prisma.user.findUnique({ where: { email: EMAIL(16) } });
    expect(user).not.toBeNull();
    if (user) userIds.push(user.id);

    const shelter = await prisma.shelter.findUnique({
      where: { wpPostId: 900161 },
    });
    const volunteer = await prisma.volunteer.findUnique({
      where: { wpPostId: 900162 },
    });
    expect(shelter?.profileId).toBe(user!.id);
    expect(volunteer?.ownerProfileId).toBe(user!.id);
  });

  it('legacy user without account resets the password via e-mail link and gets migrated', async () => {
    const legacyId = 900099n;
    const postId = 900099n;
    const oldWpPassword = 'Case99OldWpPass!';
    const newPassword = 'Case99NewPass!';
    legacyIds.push(legacyId);
    postIds.push(postId);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacyId,
        userLogin: 'e2ecase99',
        userEmail: EMAIL(99).toUpperCase(),
        userPass: buildPhpassHash(oldWpPassword),
        displayName: 'E2E Case 99',
        migrated: false,
      },
    });
    await prisma.wpPostRaw.create({
      data: {
        id: postId,
        postAuthor: legacyId,
        postType: 'abrigo',
        postStatus: 'publish',
        postTitle: 'E2E Case 99 Shelter',
      },
    });
    await createUnlinkedShelter('E2E Case 99 Shelter', 900099);
    shelterWpPostIds.push(900099);

    const sendPasswordReset = jest
      .spyOn(app.get(MailService), 'sendPasswordReset')
      .mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: EMAIL(99) })
      .expect(200);

    expect(sendPasswordReset).toHaveBeenCalledTimes(1);
    const [sentTo, link] = sendPasswordReset.mock.calls[0];
    sendPasswordReset.mockRestore();
    expect(sentTo).toBe(EMAIL(99));
    const token = new URL(link).searchParams.get('token') as string;
    redisPwdResetKeys.push(
      `pwdreset:${createHash('sha256').update(token).digest('hex')}`,
    );

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(200);

    const user = await prisma.user.findUnique({ where: { email: EMAIL(99) } });
    expect(user?.wpUserId).toBe(900099);
    expect(user?.role).toBe('abrigo');
    if (user) userIds.push(user.id);

    const legacy = await prisma.wpUserLegacy.findUnique({
      where: { id: legacyId },
    });
    expect(legacy?.migrated).toBe(true);
    const shelter = await prisma.shelter.findUnique({
      where: { wpPostId: 900099 },
    });
    expect(shelter?.profileId).toBe(user!.id);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(99), password: newPassword })
      .expect(200);
    expect(login.body).toEqual({
      ok: true,
      migrated: true,
      postType: 'abrigo',
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(99), password: oldWpPassword })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'AnotherPass!' })
      .expect(400);
  });

  it('Case 17: a new account cannot log in until the e-mail is confirmed, and the link is single-use', async () => {
    const email = EMAIL(17, '-verify');
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'NewAccount123', registerType: 'voluntario' })
      .expect(200);
    const userId = (registered.body as { userId: string }).userId;
    userIds.push(userId);
    expect(registered.body).toEqual({
      ok: true,
      userId,
      verificationRequired: true,
    });
    expect(registered.headers['set-cookie']).toBeUndefined();

    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'NewAccount123' })
      .expect(403);
    expect(blocked.body).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });

    const token = randomBytes(32).toString('base64url');
    const key = `emailverify:${sha256(token)}`;
    redisPwdResetKeys.push(key, `emailverify_user:${userId}`);
    await redis.client.set(key, userId, 'EX', 60);

    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token, password: 'SenhaDoAtacante123' })
      .expect(400)
      .expect((res) =>
        expect(res.body).toMatchObject({ code: 'INVALID_PASSWORD' }),
      );
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'NewAccount123' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token, password: 'NewAccount123' })
      .expect(200, { ok: true });
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'NewAccount123' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token, password: 'NewAccount123' })
      .expect(400);
  });
});
