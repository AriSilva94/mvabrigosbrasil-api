import { UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService, Claims } from '../jwt/token.service';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: Reflector;
  let tokenService: TokenService;
  let verifyMock: jest.Mock;

  const claims: Claims = {
    sub: 'user-1',
    email: 'user@example.com',
    role: 'admin',
    isTeamOnly: false,
    teamDisabled: false,
    creatorProfileId: null,
    sid: 'session-1',
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
    verifyMock = jest.fn();
    tokenService = { verify: verifyMock } as unknown as TokenService;
    guard = new JwtAuthGuard(reflector, tokenService);
  });

  function makeContext(req: {
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    user?: Claims;
  }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  it('allows a @Public() route with no token', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    const req = { cookies: {}, headers: {} };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(req).not.toHaveProperty('user');
  });

  it('throws Unauthorized when there is no token and the route is not public', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    const req = { cookies: {}, headers: {} };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Não autenticado');
  });

  it('allows and sets req.user when the mv_at cookie holds a valid token', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    verifyMock.mockResolvedValue(claims);
    const req: {
      cookies: Record<string, string>;
      headers: Record<string, string>;
      user?: Claims;
    } = {
      cookies: { mv_at: 'valid-cookie-token' },
      headers: {},
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifyMock).toHaveBeenCalledWith('valid-cookie-token');
    expect(req.user).toEqual(claims);
  });

  it('allows and sets req.user from a Bearer token when there is no cookie', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    verifyMock.mockResolvedValue(claims);
    const req: {
      cookies: Record<string, string>;
      headers: Record<string, string>;
      user?: Claims;
    } = {
      cookies: {},
      headers: { authorization: 'Bearer valid-bearer-token' },
    };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(verifyMock).toHaveBeenCalledWith('valid-bearer-token');
    expect(req.user).toEqual(claims);
  });

  it('throws Unauthorized when the token is invalid/expired and the route is not public', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(false);
    verifyMock.mockResolvedValue(null);
    const req = { cookies: { mv_at: 'garbage-token' }, headers: {} };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toThrow('Não autenticado');
  });

  it('allows a @Public() route even when the token is invalid', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(true);
    verifyMock.mockResolvedValue(null);
    const req = { cookies: { mv_at: 'garbage-token' }, headers: {} };
    const ctx = makeContext(req);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
