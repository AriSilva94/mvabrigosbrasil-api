import { BadRequestException, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './jwt/token.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

describe('AuthController (verify-email, resend-verification)', () => {
  let app: INestApplication;
  const authService = {
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: TokenService, useValue: { verify: jest.fn() } },
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

  const http = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]);

  it('verify-email: 200 { ok: true } for a valid token', async () => {
    authService.verifyEmail.mockResolvedValue({ ok: true });

    const res = await http()
      .post('/auth/verify-email')
      .send({ token: 'abc', password: 'senha-correta' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(authService.verifyEmail).toHaveBeenCalledWith(
      'abc',
      'senha-correta',
    );
  });

  it('verify-email: 400 without calling the service when the password is missing', async () => {
    await http().post('/auth/verify-email').send({ token: 'abc' }).expect(400);
    expect(authService.verifyEmail).not.toHaveBeenCalled();
  });

  it('verify-email: 400 without calling the service when the token is missing', async () => {
    const res = await http().post('/auth/verify-email').send({}).expect(400);

    expect(res.body).toEqual({ error: 'Link inválido ou expirado' });
    expect(authService.verifyEmail).not.toHaveBeenCalled();
  });

  it('verify-email: propagates 400 for an invalid or reused token', async () => {
    authService.verifyEmail.mockRejectedValue(
      new BadRequestException({ error: 'Link inválido ou expirado' }),
    );

    await http()
      .post('/auth/verify-email')
      .send({ token: 'used', password: 'x' })
      .expect(400);
  });

  it('resend-verification: always 200, even with a malformed body', async () => {
    authService.resendVerification.mockResolvedValue({ ok: true });

    await http().post('/auth/resend-verification').send({}).expect(200);

    expect(authService.resendVerification).toHaveBeenCalledWith('');
  });
});
