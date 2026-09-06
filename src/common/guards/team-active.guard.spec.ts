import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Claims } from '../../auth/jwt/token.service';
import { TEAM_ACTIVE_KEY } from '../decorators/team-active';
import { TeamActiveGuard } from './team-active.guard';

describe('TeamActiveGuard', () => {
  let guard: TeamActiveGuard;
  let reflector: Reflector;
  let getAllAndOverride: jest.Mock;

  const baseClaims: Claims = {
    sub: 'user-1',
    email: 'user@example.com',
    role: 'gerente',
    isTeamOnly: false,
    teamDisabled: false,
    creatorProfileId: null,
    sid: 'session-1',
  };

  beforeEach(() => {
    getAllAndOverride = jest.fn();
    reflector = { getAllAndOverride } as unknown as Reflector;
    guard = new TeamActiveGuard(reflector);
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

  it('allows when the handler has no @RequireTeamActive metadata', () => {
    getAllAndOverride.mockReturnValue(undefined);

    expect(
      guard.canActivate(makeContext({ ...baseClaims, teamDisabled: true })),
    ).toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(TEAM_ACTIVE_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });

  it('allows when @RequireTeamActive is present and teamDisabled is false', () => {
    getAllAndOverride.mockReturnValue(true);

    expect(
      guard.canActivate(makeContext({ ...baseClaims, teamDisabled: false })),
    ).toBe(true);
  });

  it('throws Forbidden when @RequireTeamActive is present and teamDisabled is true', () => {
    getAllAndOverride.mockReturnValue(true);

    expect(() =>
      guard.canActivate(makeContext({ ...baseClaims, teamDisabled: true })),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(makeContext({ ...baseClaims, teamDisabled: true })),
    ).toThrow('Acesso negado');
  });

  it('throws Forbidden when @RequireTeamActive is present but req.user is missing', () => {
    getAllAndOverride.mockReturnValue(true);

    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      'Acesso negado',
    );
  });
});
