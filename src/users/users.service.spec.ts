import { UsersService } from './users.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { User } from '../generated/prisma/client';
import { UserRole } from '../generated/prisma/enums';

type PrismaMock = {
  user: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  wpPostRaw: {
    findFirst: jest.Mock;
  };
};

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'foo@bar.com',
    passwordHash: null,
    emailVerified: false,
    fullName: null,
    phone: null,
    role: null,
    wpUserId: null,
    origin: 'supabase_native',
    isTeamOnly: false,
    teamDisabled: false,
    creatorProfileId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('UsersService', () => {
  let prisma: PrismaMock;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      wpPostRaw: {
        findFirst: jest.fn(),
      },
    };
    service = new UsersService(prisma as unknown as PrismaService);
  });

  describe('findByEmail', () => {
    it('normalizes email (trim + lowercase) before querying', async () => {
      const user = makeUser();
      prisma.user.findFirst.mockResolvedValue(user);

      const result = await service.findByEmail('  Foo@Bar.COM ');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'foo@bar.com' },
      });
      expect(result).toBe(user);
    });

    it('returns null when no user matches', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.findByEmail('missing@example.com');

      expect(result).toBeNull();
    });
  });

  describe('resolveRole', () => {
    it('returns the stored role without querying wp_posts_raw', async () => {
      const user = makeUser({ role: UserRole.abrigo });

      const result = await service.resolveRole(user);

      expect(result).toBe(UserRole.abrigo);
      expect(prisma.wpPostRaw.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('falls back to wp_posts_raw by wpUserId, persists and returns the role', async () => {
      const user = makeUser({ role: null, wpUserId: 42 });
      prisma.wpPostRaw.findFirst.mockResolvedValue({
        postType: 'abrigo',
      });

      const result = await service.resolveRole(user);

      expect(prisma.wpPostRaw.findFirst).toHaveBeenCalledWith({
        where: {
          postAuthor: 42n,
          postType: { in: [UserRole.abrigo, UserRole.voluntario] },
          postStatus: 'publish',
        },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { role: UserRole.abrigo },
      });
      expect(result).toBe(UserRole.abrigo);
    });

    it('returns null and does not update when there is no wp_posts_raw match', async () => {
      const user = makeUser({ role: null, wpUserId: 42 });
      prisma.wpPostRaw.findFirst.mockResolvedValue(null);

      const result = await service.resolveRole(user);

      expect(result).toBeNull();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('returns null without querying wp_posts_raw when wpUserId is null', async () => {
      const user = makeUser({ role: null, wpUserId: null });

      const result = await service.resolveRole(user);

      expect(result).toBeNull();
      expect(prisma.wpPostRaw.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('findTeamUsers', () => {
    it('queries users by creatorProfileId and isTeamOnly', async () => {
      const users = [
        makeUser({ isTeamOnly: true, creatorProfileId: 'creator-1' }),
      ];
      prisma.user.findMany.mockResolvedValue(users);

      const result = await service.findTeamUsers('creator-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { creatorProfileId: 'creator-1', isTeamOnly: true },
      });
      expect(result).toBe(users);
    });
  });

  describe('setTeamDisabled', () => {
    it('updates teamDisabled for the given user', async () => {
      prisma.user.update.mockResolvedValue(makeUser());

      await service.setTeamDisabled('user-1', true);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { teamDisabled: true },
      });
    });
  });
});
