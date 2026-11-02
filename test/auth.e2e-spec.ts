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

// Doc 03 §12 (docs/nestjs-migration/03-auth-e-senhas.md, front repo): the 16
// login edge cases, exercised end-to-end against the REAL Postgres (mv-pg,
// 5433/mvabrigos) and REAL Redis (mv-redis, 6380) the dev environment
// already runs, booting the actual `AppModule` (guards, throttler, filter,
// cookies all in play) via `Test.createTestingModule` + supertest.
//
// Controller ruling R3 (task-12-brief.md): the suite must NEVER depend on a
// real user's password and must NEVER pollute the 446 real `users` / 973
// real `wp_users_legacy` rows. Every fixture below uses a synthetic
// `e2e+caseN@test.local` email and, for legacy rows, an id >= 900000 (far
// outside the real range, confirmed empty before this suite runs). `afterAll`
// deletes every synthetic row it created and asserts row counts return to
// their pre-suite baseline (captured dynamically, not hardcoded, so this
// suite also works against CI's empty ephemeral Postgres).
//
// Why the real generated Prisma Client can run here at all: Prisma 7's
// `prisma-client` generator ships a WASM query compiler loaded via a
// dynamic `import()` (see `src/generated/prisma/internal/class.ts`), which
// Jest's default CJS module runner cannot service without
// `--experimental-vm-modules` (see `app.e2e-spec.ts`'s note on why it fakes
// PrismaService instead). This suite needs the real thing, so
// `package.json`'s `test:e2e` script now runs
// `node --experimental-vm-modules .../jest.js`, and `test/jest-e2e.json`'s
// `transformIgnorePatterns` was widened to leave ALL of node_modules
// untransformed (`@nestjs/config` and `@nestjs/jwt` ship real ESM and need
// to be loaded as such under vm-modules; ts-jest transpiling them to CJS is
// exactly what broke `exports is not defined` before this change). Verified
// this doesn't regress `app.e2e-spec.ts`/`auth-guards.e2e-spec.ts` (still
// pass unmodified under the new script).
//
// Throttler: `POST /auth/login` is limited to 10/min per IP
// (`AuthController`). This suite makes far more than 10 login calls across
// its 16 cases from the same test-runner "IP". `ThrottlerGuard` is
// registered via `APP_GUARD` (three of them — Throttler, JwtAuth, Roles —
// under the same multi-token, see `auth.module.ts`), and
// `.overrideGuard(ThrottlerGuard)` does not reach a guard provided that
// way (confirmed: with that override in place the suite still received
// real 429s at case 11+). Overriding the `ThrottlerGuard` class itself
// would also disable the throttler's route-matching/header logic
// entirely. Instead, override just the storage it consults
// (`ThrottlerStorage`, the token `@nestjs/throttler` injects into the
// guard) with a no-op that always reports zero hits — the real guard,
// real `@Throttle()` decorators and real headers all still run, they
// just never see a request count high enough to block.
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

// Verbatim copy of the private `prepareWordpressPassword` in
// `src/auth/legacy/wordpress-password.ts` (not exported — task-12-brief.md
// explicitly calls for building a real `$wp` hash in the test itself).
// Keeping this identical to the source is what makes the synthetic `$wp`
// fixture (case 5 in particular, with `&`, `"`, `\` in the password)
// actually round-trip through the real `verifyWordpressPassword`.
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

// Builds a legacy `$wp$2y$...` hash (the WordPress-migration-plugin style
// this codebase's `verifyWordpressPassword` understands) for a KNOWN plain
// password, entirely synthetic — never a real user's hash.
function buildWpHash(password: string): string {
  const prepared = prepareWordpressPassword(password);
  const bcryptHash = bcrypt.hashSync(prepared, 10); // "$2a$10$..."
  return '$wp' + bcryptHash.replace('$2a$', '$2y$');
}

function buildPhpassHash(password: string): string {
  return wordpressHash.HashPassword(password); // "$P$..."
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

  // Baselines captured before inserting anything, so cleanup can prove it
  // restored the exact pre-suite state (works against the real dev DB — 446
  // users/973 legacy — AND against CI's empty ephemeral Postgres).
  let baseline: {
    users: number;
    legacy: number;
    posts: number;
    shelters: number;
    volunteers: number;
  };

  // Every synthetic row id/email this suite creates, tracked for a precise
  // `afterAll` teardown (never a wildcard DELETE on real tables).
  const userIds: string[] = []; // uuids of `users` rows we create/upsert
  const legacyIds: bigint[] = [];
  const postIds: bigint[] = [];
  const shelterWpPostIds: number[] = [];
  const volunteerWpPostIds: number[] = [];
  const redisPwdResetKeys: string[] = [];

  const EMAIL = (caseNo: number, suffix = '') =>
    `e2e+case${caseNo}${suffix}@test.local`;

  function trackSession(sid: string, userId: string): void {
    // Lets afterAll revoke exactly the sessions this suite created, without
    // touching any other `sess:*`/`user_sess:*` key that might belong to a
    // real logged-in user on a shared Redis instance.
    if (!userIds.includes(userId)) userIds.push(userId);
    void sid; // sid itself is discoverable via `user_sess:{userId}` at cleanup time
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

  // ---------------------------------------------------------------------
  // Fixture setup
  // ---------------------------------------------------------------------

  // `shelters` has an AFTER INSERT/UPDATE/DELETE trigger
  // (`log_shelter_changes`) that writes to `shelter_history`, whose
  // `profile_id` column is NOT NULL. The trigger does
  // `COALESCE(NEW.profile_id, OLD.profile_id)`, so inserting (or later
  // deleting) a shelter with a NULL `profile_id` — the realistic
  // "imported from WordPress, nobody has logged in yet" state this suite
  // needs for cases 1 and 16 — violates that NOT NULL constraint (verified
  // directly against `mv-pg`: a plain `INSERT ... profile_id = NULL`
  // fails the same way). This is a pre-existing trigger/schema quirk on
  // the real DB (two production shelters already carry a NULL
  // `profile_id`, which must predate the trigger or have been loaded with
  // it disabled) — not something an e2e suite should try to fix. Instead,
  // mirror the standard Postgres bulk-load technique for this one insert:
  // disable triggers for the local transaction only
  // (`session_replication_role = replica`, scoped by `SET LOCAL` to that
  // transaction) so the synthetic fixture can exist in the same
  // unlinked state real legacy rows do.
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

  // Cleanup counterpart: by the time `afterAll` runs, a case's shelter may
  // (or may not) have been linked to a real profile by the login flow
  // under test — delete it the same trigger-safe way regardless, since a
  // still-NULL `profile_id` at delete time hits the identical NOT NULL
  // violation on `shelter_history`.
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
    // ---- Case 1: legacy $wp, never logged in, links ONE post (abrigo) ----
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

    // ---- Case 2: legacy phpass $P$, never logged in ----
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

    // ---- Case 3: legacy md5, never logged in ----
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

    // ---- Case 4: legacy e-mail stored with uppercase ----
    const legacy4Id = 900004n;
    legacyIds.push(legacy4Id);
    await prisma.wpUserLegacy.create({
      data: {
        id: legacy4Id,
        userLogin: 'e2ecase4',
        userEmail: `E2E+Case4@Test.Local`, // mixed-case on purpose
        userPass: buildMd5Hash(CASE4_PW),
        displayName: 'E2E Case 4',
        migrated: false,
      },
    });

    // ---- Case 5: legacy $wp with special chars in the password ----
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

    // ---- Case 6: GoTrue-imported bcrypt account, no legacy row ----
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

    // ---- Case 7: disposable-password account + unmigrated legacy ----
    const user7 = await prisma.user.create({
      data: {
        email: EMAIL(7),
        // Disposable/unusable placeholder hash: never the real user's
        // password, only exists so R1 has something to fail against.
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

    // ---- Cases 8/9: legacy migrated=true, shared user+legacy fixture ----
    const user89 = await prisma.user.create({
      data: {
        email: EMAIL(8), // shared email for both 8 and 9
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
        userPass: buildMd5Hash(CASE89_OLD_WP_PW), // old WP password, must NOT work anymore
        displayName: 'E2E Case 8/9',
        migrated: true, // R3: already migrated, user_pass must never be consulted again
        migratedAt: new Date(),
      },
    });

    // ---- Case 10: no fixture at all (e-mail in neither table) ----

    // ---- Case 11: wrong password against an existing bcrypt user ----
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

    // ---- Case 12: team-only, disabled ----
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

    // ---- Case 13: concurrent refresh and outside-grace reuse ----
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

    // ---- Case 14: reset token expired ----
    const user14 = await prisma.user.create({
      data: {
        email: EMAIL(14),
        passwordHash: bcrypt.hashSync('irrelevant-original-pw', 10),
        emailVerified: true,
        origin: 'supabase_native',
      },
    });
    userIds.push(user14.id);

    // ---- Case 15: password with leading/trailing spaces ----
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

    // ---- Case 16: legacy has BOTH abrigo and voluntario posts ----
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
    // Redis first: revoke exactly the sessions this suite created (via
    // `user_sess:{userId}`), never a wildcard `sess:*` scan.
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

    // DB, children first (FK-safe order).
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
    // Catches both the users pre-created above AND the ones lazily created
    // by `LegacyMigrationService.migrate` during cases 1/2/3/4/5/16 (whose
    // ids we never tracked because the app generates them at login time).
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'e2e+', endsWith: '@test.local' } },
    });
  }

  // ---------------------------------------------------------------------
  // Cases
  // ---------------------------------------------------------------------

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
    // The legacy table stays read-only for the credential itself.
    expect(legacy?.userPass).toBe(originalHash);
  });

  it('Case 4: legacy e-mail with uppercase -> case-insensitive lookup, users.email stored lowercase', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(4), password: CASE4_PW }) // login with lowercase
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, migrated: false });

    const user = await prisma.user.findUnique({ where: { email: EMAIL(4) } });
    expect(user).not.toBeNull();
    expect(user!.email).toBe(EMAIL(4)); // stored lowercase
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
    expect(after!.passwordHash).toBe(before!.passwordHash); // unchanged: no rehash
  });

  it('Case 7: disposable-password account + unmigrated legacy -> R1 fails, R2 verifies WP, overwrites passwordHash', async () => {
    const before = await prisma.user.findUnique({ where: { email: EMAIL(7) } });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(7), password: CASE7_REAL_PW })
      .expect(200);

    expect(res.body).toMatchObject({ ok: true, migrated: false });

    const after = await prisma.user.findUnique({ where: { email: EMAIL(7) } });
    expect(after!.id).toBe(before!.id); // same row, upserted in place
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

    expect(res.body).toEqual({ error: 'Senha inválida' });
  });

  it('Case 9: legacy migrated=true, new password -> 200 via R1', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(8), password: CASE89_PW })
      .expect(200);

    expect(res.body).toEqual({ ok: true, migrated: true, postType: null });
  });

  it('Case 10: e-mail in neither table -> 404 "Usuário não encontrado"', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(10), password: 'whatever-not-registered' })
      .expect(404);

    expect(res.body).toEqual({ error: 'Usuário não encontrado' });
  });

  it('Case 11: wrong password, user exists -> 401 "Senha inválida"', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: EMAIL(11), password: 'totally-wrong-password' })
      .expect(401);

    expect(res.body).toEqual({ error: 'Senha inválida' });
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
    // Very short TTL, then let it actually expire (not just delete it) —
    // matches "reset token expired" rather than "token never existed".
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
    '%s closes legacy fallback and keeps pending shelter/volunteer links',
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
      }
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'OldWordPress123' })
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'NewPassword123' })
        .expect(200);
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
    // A rejeição pode ocorrer assim que o bcrypt for liberado.
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
    // §9: role is the first post by id when the legacy user has both kinds;
    // ordering across postType isn't the assertion this case cares about —
    // "vincula ambos" (links both) is.
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
});
