import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TokenService } from './../src/auth/jwt/token.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import cookieParser from 'cookie-parser';

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

    tokenService = app.get(TokenService);
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

  it('POST /api/v1/auth/logout requires a session (401 without token)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .expect(401);
    expect(res.body).toEqual({ error: 'Não autenticado' });
  });

  it('throttles POST /api/v1/auth/forgot-password after 3 requests/10min per IP (429)', async () => {
    const server = app.getHttpServer();
    // Body sem `email` válido: `forgotPasswordSchema` falha o parse e o
    // controller trata como e-mail vazio, que sempre resolve `{ok:true}`
    // sem consultar o banco (evita depender do Prisma real/fake aqui — o
    // que importa neste teste é só o comportamento do throttler por IP).
    for (let i = 0; i < 3; i += 1) {
      await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({})
        .expect(200);
    }

    const res = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({})
      .expect(429);

    expect(res.body).toHaveProperty('error');
  });
});
