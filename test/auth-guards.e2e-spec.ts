import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TokenService } from './../src/auth/jwt/token.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { RedisService } from './../src/redis/redis.service';
import cookieParser from 'cookie-parser';
import { tokensWithSessions } from './helpers/active-session';

// Task 11: guards globais (`JwtAuthGuard`/`RolesGuard`/`ThrottlerGuard`,
// registrados via `APP_GUARD` em `AuthModule`) passam a valer para TODA a
// aplicação. Este suite prova, contra o `AppModule` real (Prisma trocado
// pelo fake — mesmo motivo do `app.e2e-spec.ts`, ver comentário lá):
//
//  - `/api/v1/health` continua público (sem token).
//  - Uma rota protegida (`/api/v1/auth/me`) 401 sem token e 200 com um
//    token válido.
//  - Uma rota `@Public()` com throttling (`/api/v1/auth/forgot-password`,
//    3 por 10min por IP) responde 429 depois do limite.
class FakePrismaService {
  onModuleInit(): void {}
  onModuleDestroy(): void {}
  $queryRaw(): Promise<unknown> {
    return Promise.resolve([{ '?column?': 1 }]);
  }
}

describe('Global guards + throttling (e2e)', () => {
  let app: INestApplication<App>;
  let tokenService: TokenService;
  let redisService: RedisService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useClass(FakePrismaService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    // Mesmo filtro global do `main.ts` — sem ele, exceções renderizam no
    // shape padrão do Nest (`{statusCode, message, error}`) em vez do
    // `{error}` esperado pelo resto da API.
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    tokenService = tokensWithSessions(app);
    redisService = app.get(RedisService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1/health stays public (200, no token)', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it('GET /api/v1/auth/me returns 401 {error} without a token', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);
    expect(res.body).toEqual({ error: 'Não autenticado' });
  });

  it('GET /api/v1/auth/me returns 200 with a valid access token', async () => {
    const token = await tokenService.sign({
      sub: 'user-1',
      email: 'user@example.com',
      role: 'voluntario',
      isTeamOnly: false,
      teamDisabled: false,
      creatorProfileId: null,
      sid: 'sid-1',
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', [`mv_at=${token}`])
      .expect(200);

    expect(res.body).toMatchObject({
      user: { id: 'user-1', email: 'user@example.com' },
    });
  });

  it('POST /api/v1/auth/login is reachable without a token (public)', async () => {
    // Body inválido: prova que a requisição passou pelo guard de auth (não
    // recebeu 401 "Não autenticado") — a 400 vem da validação de negócio
    // do próprio `login` (Task 7/8), não do guard.
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({})
      .expect(400);
    expect(res.body).toEqual({ error: 'E-mail e senha são obrigatórios' });
  });

  it('POST /api/v1/auth/logout is public and idempotent: 200 + clears cookies with NO cookies at all', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .expect(200);
    expect(res.body).toEqual({ ok: true });

    const setCookie = res.headers['set-cookie'] as unknown as
      string[] | undefined;
    expect(setCookie).toBeDefined();
    const cleared = setCookie ?? [];
    expect(cleared.some((c) => c.startsWith('mv_at=;'))).toBe(true);
    expect(cleared.some((c) => c.startsWith('mv_rt=;'))).toBe(true);
  });

  it('POST /api/v1/auth/logout is public and idempotent: 200 + clears cookies with an expired/absent mv_at but a (garbage) mv_rt', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', ['mv_rt=fakesid.fakert'])
      .expect(200);
    expect(res.body).toEqual({ ok: true });

    const setCookie =
      (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
    expect(setCookie.some((c) => c.startsWith('mv_at=;'))).toBe(true);
    expect(setCookie.some((c) => c.startsWith('mv_rt=;'))).toBe(true);
  });

  it('POST /api/v1/auth/logout revokes a real session from Redis (sess:{sid} deleted)', async () => {
    // Seeds `sess:{sid}` directly in the real Redis instance (same shape
    // `SessionService` writes), instead of going through `login` (which
    // needs a real Postgres user — out of scope here, Prisma is faked).
    // Proves `logout` reaches `SessionService.revoke(sid)` for a sid
    // recovered from `mv_rt`, end to end through the real Redis client.
    const sid = `e2e-sid-${Date.now()}`;
    await redisService.client.set(
      `sess:${sid}`,
      JSON.stringify({
        userId: 'user-1',
        rtHash: 'irrelevant-for-this-test',
        createdAt: Date.now(),
      }),
      'EX',
      3600,
    );
    await redisService.client.sadd(`user_sess:user-1`, sid);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', [`mv_rt=${sid}.some-refresh-token`])
      .expect(200);
    expect(res.body).toEqual({ ok: true });

    const stillThere = await redisService.client.get(`sess:${sid}`);
    expect(stillThere).toBeNull();
    const stillMember = await redisService.client.sismember(
      'user_sess:user-1',
      sid,
    );
    expect(stillMember).toBe(0);
  });

  it('throttles POST /api/v1/auth/forgot-password after 3 requests/10min per IP (429)', async () => {
    const server = app.getHttpServer();
    // O contador agora vive no Redis e sobreviveria entre execuções da suíte.
    const throttleKeys = await redisService.client.keys('throttle:*');
    if (throttleKeys.length > 0) await redisService.client.del(...throttleKeys);
    // Body sem `email` válido: `forgotPasswordSchema` falha o parse e o
    // controller trata como e-mail vazio, que sempre resolve `{ok:true}`
    // sem consultar o banco (evita depender do Prisma real/fake aqui — o
    // que importa neste teste é só o comportamento do throttler por IP).
    for (let i = 0; i < 3; i += 1) {
      await request(server)
        .post('/api/v1/auth/forgot-password')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({})
        .expect(200);
    }

    const res = await request(server)
      .post('/api/v1/auth/forgot-password')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({})
      .expect(429);

    expect(res.body).toHaveProperty('error');
  });

  it('does not throttle internal server-side calls without proxy headers', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 5; i += 1) {
      await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({})
        .expect(200);
    }
  });
});
