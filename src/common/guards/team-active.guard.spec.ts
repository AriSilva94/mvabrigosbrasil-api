import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Claims } from '../../auth/jwt/token.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { TEAM_ACTIVE_KEY } from '../decorators/team-active';
import { TeamActiveGuard } from './team-active.guard';

describe('TeamActiveGuard', () => {
  let guard: TeamActiveGuard;
  let reflector: Reflector;
  let getAllAndOverride: jest.Mock;
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

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
    jest.clearAllMocks();
    getAllAndOverride = jest.fn();
    reflector = { getAllAndOverride } as unknown as Reflector;
    guard = new TeamActiveGuard(reflector, prisma as unknown as PrismaService);
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

  function activate(user?: Claims): Promise<boolean> {
    return Promise.resolve().then(() => guard.canActivate(makeContext(user)));
  }

  it('allows without metadata and does not query Prisma', async () => {
    getAllAndOverride.mockReturnValue(undefined);

    await expect(
      activate({
        ...baseClaims,
        isTeamOnly: true,
        teamDisabled: true,
      }),
    ).resolves.toBe(true);
    expect(getAllAndOverride).toHaveBeenCalledWith(TEAM_ACTIVE_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('allows a normal non-team user without querying Prisma', async () => {
    getAllAndOverride.mockReturnValue(true);

    await expect(activate(baseClaims)).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('denies a disabled claim without querying Prisma', async () => {
    getAllAndOverride.mockReturnValue(true);

    await expect(
      activate({ ...baseClaims, isTeamOnly: true, teamDisabled: true }),
    ).rejects.toThrow(new ForbiddenException('Acesso negado'));
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('denies when req.user is missing without querying Prisma', async () => {
    getAllAndOverride.mockReturnValue(true);

    await expect(activate(undefined)).rejects.toThrow(
      new ForbiddenException('Acesso negado'),
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('denies a stale active claim when the current user is disabled', async () => {
    getAllAndOverride.mockReturnValue(true);
    prisma.user.findUnique.mockResolvedValue({
      isTeamOnly: true,
      teamDisabled: true,
    });

    await expect(
      activate({ ...baseClaims, isTeamOnly: true, teamDisabled: false }),
    ).rejects.toThrow(new ForbiddenException('Acesso negado'));
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: baseClaims.sub },
      select: { isTeamOnly: true, teamDisabled: true },
    });
  });

  it('allows an active team-only user from current database state', async () => {
    getAllAndOverride.mockReturnValue(true);
    prisma.user.findUnique.mockResolvedValue({
      isTeamOnly: true,
      teamDisabled: false,
    });

    await expect(
      activate({ ...baseClaims, isTeamOnly: true, teamDisabled: false }),
    ).resolves.toBe(true);
  });

  it.each([
    ['missing', null],
    ['no longer team-only', { isTeamOnly: false, teamDisabled: false }],
  ])(
    'fails closed when the current user is %s',
    async (_label, currentUser) => {
      getAllAndOverride.mockReturnValue(true);
      prisma.user.findUnique.mockResolvedValue(currentUser);

      await expect(
        activate({ ...baseClaims, isTeamOnly: true, teamDisabled: false }),
      ).rejects.toThrow(new ForbiddenException('Acesso negado'));
    },
  );

  it('fails closed when the authoritative lookup fails', async () => {
    getAllAndOverride.mockReturnValue(true);
    prisma.user.findUnique.mockRejectedValue(new Error('database unavailable'));

    await expect(
      activate({ ...baseClaims, isTeamOnly: true, teamDisabled: false }),
    ).rejects.toThrow(new ForbiddenException('Acesso negado'));
  });
});
