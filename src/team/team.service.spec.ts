import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { SessionService } from '../redis/session.service';
import { TeamService } from './team.service';

describe('TeamService', () => {
  const prisma = {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const sessions = { revokeAll: jest.fn() };
  let service: TeamService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TeamService(
      prisma as unknown as PrismaService,
      sessions as unknown as SessionService,
    );
  });

  it('lists only team-only users created by the current user', async () => {
    const createdAt = new Date('2026-09-01T12:00:00.000Z');
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'member-id',
        email: 'member@example.com',
        createdAt,
        teamDisabled: true,
      },
    ]);

    await expect(service.listUsers('creator-id')).resolves.toEqual({
      users: [
        {
          id: 'member-id',
          email: 'member@example.com',
          createdAt,
          isDisabled: true,
        },
      ],
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { creatorProfileId: 'creator-id', isTeamOnly: true },
      select: {
        id: true,
        email: true,
        createdAt: true,
        teamDisabled: true,
      },
    });
  });

  it('returns 404 when the toggle target does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.toggleUser('creator-id', 'missing-id', true),
    ).rejects.toThrow(new NotFoundException('Usuário não encontrado.'));
  });

  it('maps a target lookup failure to the literal toggle error', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('db down'));

    await expect(
      service.toggleUser('creator-id', 'member-id', true),
    ).rejects.toThrow(
      new InternalServerErrorException(
        'Não foi possível alterar o status do usuário.',
      ),
    );
  });

  it.each([
    [{ isTeamOnly: false, creatorProfileId: 'creator-id' }],
    [{ isTeamOnly: true, creatorProfileId: 'other-creator' }],
  ])('rejects a target outside the creator team', async (target) => {
    prisma.user.findUnique.mockResolvedValue(target);

    await expect(
      service.toggleUser('creator-id', 'member-id', true),
    ).rejects.toThrow(
      new ForbiddenException('Acesso negado para alterar este usuário.'),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('disables an owned team user and revokes all sessions', async () => {
    prisma.user.findUnique.mockResolvedValue({
      isTeamOnly: true,
      creatorProfileId: 'creator-id',
    });
    prisma.user.update.mockResolvedValue({});

    await expect(
      service.toggleUser('creator-id', 'member-id', true),
    ).resolves.toEqual({ ok: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'member-id' },
      data: { teamDisabled: true },
    });
    expect(sessions.revokeAll).toHaveBeenCalledWith('member-id');
    expect(prisma.user.update.mock.invocationCallOrder[0]).toBeLessThan(
      sessions.revokeAll.mock.invocationCallOrder[0],
    );
  });

  it('enables an owned team user without revoking sessions', async () => {
    prisma.user.findUnique.mockResolvedValue({
      isTeamOnly: true,
      creatorProfileId: 'creator-id',
    });
    prisma.user.update.mockResolvedValue({});

    await service.toggleUser('creator-id', 'member-id', false);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'member-id' },
      data: { teamDisabled: false },
    });
    expect(sessions.revokeAll).not.toHaveBeenCalled();
  });
});
