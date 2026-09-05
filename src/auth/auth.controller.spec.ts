import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

describe('AuthController (POST /auth/login)', () => {
  let app: INestApplication;
  const authService = { login: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: { get: () => false },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sets mv_at and mv_rt (sid.rt) cookies and returns body without tokens on success', async () => {
    authService.login.mockResolvedValue({
      userId: 'user-1',
      role: 'voluntario',
      migrated: true,
      at: 'signed-jwt',
      rt: 'opaque-rt',
      sid: 'session-id-1',
    });

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/auth/login')
      .send({ email: 'joao@example.com', password: 'secret' })
      .expect(200);

    expect(res.body).toEqual({
      ok: true,
      migrated: true,
      postType: 'voluntario',
    });
    expect((res.body as Record<string, unknown>).at).toBeUndefined();
    expect((res.body as Record<string, unknown>).rt).toBeUndefined();

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const atCookie = cookies.find((c) => c.startsWith('mv_at='));
    const rtCookie = cookies.find((c) => c.startsWith('mv_rt='));
    expect(atCookie).toContain('signed-jwt');
    expect(rtCookie).toContain('session-id-1.opaque-rt');
  });

  it('returns 400 when email is missing from body', async () => {
    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/auth/login')
      .send({ password: 'secret' })
      .expect(400);

    expect(res.body).toEqual({ error: 'E-mail e senha são obrigatórios' });
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('propagates 401 from AuthService as {error} body', async () => {
    authService.login.mockRejectedValue(
      new UnauthorizedException({ error: 'Senha inválida' }),
    );

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/auth/login')
      .send({ email: 'joao@example.com', password: 'wrong' })
      .expect(401);

    expect(res.body).toEqual({ error: 'Senha inválida' });
  });
});
