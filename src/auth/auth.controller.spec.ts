import {
  ConflictException,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './jwt/token.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

describe('AuthController (POST /auth/login)', () => {
  let app: INestApplication;
  const authService = {
    login: jest.fn(),
    register: jest.fn(),
    me: jest.fn(),
    postLoginRedirect: jest.fn(),
  };
  const tokenService = { verify: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TokenService, useValue: tokenService },
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

describe('AuthController (POST /auth/register, GET /auth/me)', () => {
  let app: INestApplication;
  const authService = {
    login: jest.fn(),
    register: jest.fn(),
    me: jest.fn(),
    postLoginRedirect: jest.fn(),
  };
  const tokenService = { verify: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TokenService, useValue: tokenService },
        { provide: ConfigService, useValue: { get: () => false } },
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

  it('register: sets cookies on non-team registration', async () => {
    authService.register.mockResolvedValue({
      userId: 'new-user-1',
      teamOnly: false,
      at: 'signed-jwt',
      rt: 'opaque-rt',
      sid: 'session-id-1',
    });

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/auth/register')
      .send({ email: 'joao@example.com', password: 'secretpw' })
      .expect(200);

    expect(res.body).toEqual({ ok: true, userId: 'new-user-1' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const atCookie = cookies.find((c) => c.startsWith('mv_at='));
    const rtCookie = cookies.find((c) => c.startsWith('mv_rt='));
    expect(atCookie).toContain('signed-jwt');
    expect(rtCookie).toContain('session-id-1.opaque-rt');
    expect(authService.register).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'joao@example.com',
        password: 'secretpw',
      }) as unknown,
      null,
    );
  });

  it('register: does NOT set cookies for teamOnly registration', async () => {
    authService.register.mockResolvedValue({
      userId: 'new-team-user',
      teamOnly: true,
    });
    tokenService.verify.mockResolvedValue({
      sub: 'actor-1',
      email: 'actor@example.com',
      role: 'admin',
      isTeamOnly: false,
      teamDisabled: false,
      creatorProfileId: null,
      sid: 'sid-actor',
    });

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/auth/register')
      .set('Cookie', 'mv_at=actor-token')
      .send({
        email: 'equipe@example.com',
        password: 'secretpw',
        teamOnly: true,
      })
      .expect(200);

    expect(res.body).toEqual({ ok: true, userId: 'new-team-user' });
    const cookies = res.headers['set-cookie'] as unknown as
      string[] | undefined;
    expect(cookies ?? []).toHaveLength(0);
    expect(authService.register).toHaveBeenCalledWith(
      expect.objectContaining({ teamOnly: true }) as unknown,
      expect.objectContaining({ sub: 'actor-1' }) as unknown,
    );
  });

  it('register: 400 when body is malformed', async () => {
    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/auth/register')
      .send({ password: 'secretpw' })
      .expect(400);

    expect(res.body).toEqual({ error: 'E-mail e senha são obrigatórios.' });
    expect(authService.register).not.toHaveBeenCalled();
  });

  it('register: propagates 409 from AuthService', async () => {
    authService.register.mockRejectedValue(
      new ConflictException({ error: 'E-mail já cadastrado.' }),
    );

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/auth/register')
      .send({ email: 'dup@example.com', password: 'secretpw' })
      .expect(409);

    expect(res.body).toEqual({ error: 'E-mail já cadastrado.' });
  });

  it('me: returns user when session cookie is valid', async () => {
    tokenService.verify.mockResolvedValue({
      sub: 'user-1',
      email: 'user1@example.com',
      role: 'voluntario',
      isTeamOnly: false,
      teamDisabled: false,
      creatorProfileId: null,
      sid: 'sid-1',
    });
    authService.me.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'user1@example.com',
        role: 'voluntario',
        isTeamOnly: false,
        teamDisabled: false,
        creatorProfileId: null,
      },
    });

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/auth/me')
      .set('Cookie', 'mv_at=valid-token')
      .expect(200);

    expect(res.body).toEqual({
      user: {
        id: 'user-1',
        email: 'user1@example.com',
        role: 'voluntario',
        isTeamOnly: false,
        teamDisabled: false,
        creatorProfileId: null,
      },
    });
  });

  it('me: 401 when no session cookie', async () => {
    authService.me.mockRejectedValue(
      new UnauthorizedException({ error: 'Não autenticado' }),
    );

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/auth/me')
      .expect(401);

    expect(res.body).toEqual({ error: 'Não autenticado' });
    expect(tokenService.verify).not.toHaveBeenCalled();
    expect(authService.me).toHaveBeenCalledWith(null);
  });
});

// Task 9: POST /auth/refresh, POST /auth/logout.
describe('AuthController (POST /auth/refresh, POST /auth/logout)', () => {
  let app: INestApplication;
  const authService = {
    login: jest.fn(),
    register: jest.fn(),
    me: jest.fn(),
    postLoginRedirect: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
  };
  const tokenService = { verify: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TokenService, useValue: tokenService },
        { provide: ConfigService, useValue: { get: () => false } },
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

  describe('POST /auth/refresh', () => {
    it('parses sid.rt from mv_rt, rotates, and sets fresh cookies on success', async () => {
      authService.refresh.mockResolvedValue({
        at: 'new-signed-jwt',
        rt: 'new-opaque-rt',
        sid: 'session-id-1',
      });

      const res = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post('/auth/refresh')
        .set('Cookie', 'mv_rt=session-id-1.old-opaque-rt')
        .expect(200);

      expect(res.body).toEqual({ ok: true });
      expect(authService.refresh).toHaveBeenCalledWith(
        'session-id-1',
        'old-opaque-rt',
      );

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const atCookie = cookies.find((c) => c.startsWith('mv_at='));
      const rtCookie = cookies.find((c) => c.startsWith('mv_rt='));
      expect(atCookie).toContain('new-signed-jwt');
      expect(rtCookie).toContain('session-id-1.new-opaque-rt');
    });

    it('splits rt on the FIRST dot only (rt itself may contain dots)', async () => {
      authService.refresh.mockResolvedValue({
        at: 'new-signed-jwt',
        rt: 'new-opaque-rt',
        sid: 'session-id-1',
      });

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post('/auth/refresh')
        .set('Cookie', 'mv_rt=session-id-1.part-a.part-b')
        .expect(200);

      expect(authService.refresh).toHaveBeenCalledWith(
        'session-id-1',
        'part-a.part-b',
      );
    });

    it('401 + clears cookies when mv_rt cookie is absent', async () => {
      const res = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post('/auth/refresh')
        .expect(401);

      expect(res.body).toEqual({ error: 'Sessão expirada' });
      expect(authService.refresh).not.toHaveBeenCalled();

      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('mv_at=;'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('mv_rt=;'))).toBe(true);
    });

    it('401 + clears cookies when mv_rt cookie is malformed (no dot)', async () => {
      const res = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post('/auth/refresh')
        .set('Cookie', 'mv_rt=nodothere')
        .expect(401);

      expect(res.body).toEqual({ error: 'Sessão expirada' });
      expect(authService.refresh).not.toHaveBeenCalled();
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('mv_at=;'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('mv_rt=;'))).toBe(true);
    });

    it('401 + clears cookies when AuthService.refresh rejects (rotate returned null: reused/invalid rt)', async () => {
      authService.refresh.mockRejectedValue(
        new UnauthorizedException({ error: 'Sessão expirada' }),
      );

      const res = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post('/auth/refresh')
        .set('Cookie', 'mv_rt=session-id-1.stale-rt')
        .expect(401);

      expect(res.body).toEqual({ error: 'Sessão expirada' });
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('mv_at=;'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('mv_rt=;'))).toBe(true);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session (sid parsed from mv_rt) and clears cookies', async () => {
      authService.logout.mockResolvedValue(undefined);

      const res = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post('/auth/logout')
        .set('Cookie', 'mv_rt=session-id-1.some-rt')
        .expect(200);

      expect(res.body).toEqual({ ok: true });
      expect(authService.logout).toHaveBeenCalledWith('session-id-1');
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('mv_at=;'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('mv_rt=;'))).toBe(true);
    });

    it('is idempotent: 200 + clears cookies even without a session cookie', async () => {
      const res = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .post('/auth/logout')
        .expect(200);

      expect(res.body).toEqual({ ok: true });
      expect(authService.logout).toHaveBeenCalledWith(null);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('mv_at=;'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('mv_rt=;'))).toBe(true);
    });
  });
});
