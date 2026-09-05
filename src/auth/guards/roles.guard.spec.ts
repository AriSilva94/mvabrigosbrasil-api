import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Claims } from '../jwt/token.service';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const baseClaims: Omit<Claims, 'role'> = {
    sub: 'user-1',
    email: 'user@example.com',
    isTeamOnly: false,
    teamDisabled: false,
    creatorProfileId: null,
    sid: 'session-1',
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
    guard = new RolesGuard(reflector);
  });

  function makeContext(user?: Claims): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  it('allows when the handler has no @Roles metadata', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    const ctx = makeContext(undefined);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("allows when @Roles('admin') and req.user.role is 'admin'", () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['admin']);
    const ctx = makeContext({ ...baseClaims, role: 'admin' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("throws Forbidden when @Roles('admin') and req.user.role is 'abrigo'", () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['admin']);
    const ctx = makeContext({ ...baseClaims, role: 'abrigo' });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Acesso negado');
  });

  it('throws Forbidden when @Roles is present but req.user is missing', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['admin']);
    const ctx = makeContext(undefined);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx)).toThrow('Acesso negado');
  });
});
