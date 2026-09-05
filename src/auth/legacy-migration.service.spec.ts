import { LegacyMigrationService } from './legacy-migration.service';
import { PasswordService } from './password/password.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { User, WpUserLegacy } from '../generated/prisma/client';

type UpsertData = {
  email: string;
  passwordHash: string;
  fullName: string | null;
  wpUserId: number;
  origin: string;
  emailVerified: boolean;
  isTeamOnly: boolean;
  role: string | null;
};

type UpsertArgs = {
  where: { id: string };
  create: UpsertData & { id: string };
  update: UpsertData;
};

type PostRawFindFirstArgs = {
  where: {
    postAuthor: bigint;
    postType: string | { in: string[] };
    postStatus?: string;
  };
};

type PostRawResult = { id: bigint; postType?: string } | null;

type TxMock = {
  user: { upsert: jest.Mock<Promise<User>, [UpsertArgs]> };
  volunteer: {
    updateMany: jest.Mock<
      Promise<{ count: number }>,
      [{ where: unknown; data: unknown }]
    >;
  };
  shelter: {
    updateMany: jest.Mock<
      Promise<{ count: number }>,
      [{ where: unknown; data: unknown }]
    >;
  };
  wpPostRaw: {
    findFirst: jest.Mock<Promise<PostRawResult>, [PostRawFindFirstArgs]>;
  };
  wpUserLegacy: {
    update: jest.Mock<Promise<unknown>, [{ where: unknown; data: unknown }]>;
  };
};

type PrismaMock = {
  $transaction: jest.Mock;
};

function makeLegacy(overrides: Partial<WpUserLegacy> = {}): WpUserLegacy {
  return {
    id: 42n,
    userLogin: 'joao',
    userEmail: 'Joao@Example.COM',
    userPass: '$P$Bwordpressphpasshash',
    displayName: 'Joao Legacy',
    migrated: false,
    migratedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'existing-user-id',
    email: 'joao@example.com',
    passwordHash: null,
    emailVerified: false,
    fullName: 'Existing Name',
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

function makeTx(): TxMock {
  return {
    user: {
      upsert: jest
        .fn<Promise<User>, [UpsertArgs]>()
        .mockResolvedValue(makeUser()),
    },
    volunteer: {
      updateMany: jest
        .fn<Promise<{ count: number }>, [{ where: unknown; data: unknown }]>()
        .mockResolvedValue({ count: 0 }),
    },
    shelter: {
      updateMany: jest
        .fn<Promise<{ count: number }>, [{ where: unknown; data: unknown }]>()
        .mockResolvedValue({ count: 0 }),
    },
    wpPostRaw: {
      findFirst: jest
        .fn<Promise<PostRawResult>, [PostRawFindFirstArgs]>()
        .mockResolvedValue(null),
    },
    wpUserLegacy: {
      update: jest
        .fn<Promise<unknown>, [{ where: unknown; data: unknown }]>()
        .mockResolvedValue({}),
    },
  };
}

const ROLE_LOOKUP_WHERE = {
  postAuthor: 42n,
  postType: { in: ['abrigo', 'voluntario'] },
  postStatus: 'publish',
};

describe('LegacyMigrationService', () => {
  let tx: TxMock;
  let prisma: PrismaMock;
  let service: LegacyMigrationService;
  const passwordService = new PasswordService({ get: () => 4 } as never); // custo baixo p/ testes

  beforeEach(() => {
    tx = makeTx();
    prisma = {
      $transaction: jest.fn(async (cb: (tx: TxMock) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    service = new LegacyMigrationService(
      prisma as unknown as PrismaService,
      passwordService,
    );
  });

  it('runs everything inside a single prisma.$transaction', async () => {
    await service.migrate(makeLegacy(), 'plain-pass');

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('hashes the plaintext password with bcrypt, not the legacy hash', async () => {
    await service.migrate(makeLegacy(), 'plain-pass');

    const [{ create, update }] = tx.user.upsert.mock.calls[0];
    expect(create.passwordHash).toMatch(/^\$2/);
    expect(create.passwordHash).not.toBe(makeLegacy().userPass);
    expect(update.passwordHash).toBe(create.passwordHash);
  });

  it('upserts a new user with wpUserId, lowercased email, wordpress_migrated origin and emailVerified=true', async () => {
    await service.migrate(makeLegacy(), 'plain-pass');

    const [{ where, create }] = tx.user.upsert.mock.calls[0];
    expect(where).toEqual({ id: expect.any(String) as string });
    expect(create.wpUserId).toBe(42);
    expect(create.email).toBe('joao@example.com');
    expect(create.origin).toBe('wordpress_migrated');
    expect(create.emailVerified).toBe(true);
    expect(create.fullName).toBe('Joao Legacy');
    expect(create.isTeamOnly).toBe(false);
  });

  it('resolves role from wp_posts_raw when there is no existingUser', async () => {
    tx.wpPostRaw.findFirst.mockResolvedValue({
      id: 1n,
      postType: 'voluntario',
    });

    await service.migrate(makeLegacy(), 'plain-pass');

    expect(tx.wpPostRaw.findFirst).toHaveBeenCalledWith({
      where: ROLE_LOOKUP_WHERE,
    });
    const [{ create }] = tx.user.upsert.mock.calls[0];
    expect(create.role).toBe('voluntario');
  });

  it('links the voluntario post to the migrated user via wp_post_id, guarded by owner_profile_id IS NULL', async () => {
    tx.wpPostRaw.findFirst.mockImplementation(({ where }) => {
      if (typeof where.postType === 'object') return Promise.resolve(null); // role lookup
      if (where.postType === 'voluntario') {
        return Promise.resolve({ id: 777n });
      }
      return Promise.resolve(null);
    });

    await service.migrate(makeLegacy(), 'plain-pass');

    const [{ where: userWhere }] = tx.user.upsert.mock.calls[0];
    expect(tx.wpPostRaw.findFirst).toHaveBeenCalledWith({
      where: { postType: 'voluntario', postAuthor: 42n },
    });
    expect(tx.volunteer.updateMany).toHaveBeenCalledWith({
      where: { wpPostId: 777, ownerProfileId: null },
      data: { ownerProfileId: userWhere.id },
    });
  });

  it('links the abrigo post to the migrated user via wp_post_id, guarded by profile_id IS NULL', async () => {
    tx.wpPostRaw.findFirst.mockImplementation(({ where }) => {
      if (typeof where.postType === 'object') return Promise.resolve(null); // role lookup
      if (where.postType === 'abrigo') {
        return Promise.resolve({ id: 888n });
      }
      return Promise.resolve(null);
    });

    await service.migrate(makeLegacy(), 'plain-pass');

    const [{ where: userWhere }] = tx.user.upsert.mock.calls[0];
    expect(tx.wpPostRaw.findFirst).toHaveBeenCalledWith({
      where: { postType: 'abrigo', postAuthor: 42n },
    });
    expect(tx.shelter.updateMany).toHaveBeenCalledWith({
      where: { wpPostId: 888, profileId: null },
      data: { profileId: userWhere.id },
    });
  });

  it('does not touch volunteers/shelters when there is no matching wp_posts_raw row', async () => {
    await service.migrate(makeLegacy(), 'plain-pass');

    expect(tx.volunteer.updateMany).not.toHaveBeenCalled();
    expect(tx.shelter.updateMany).not.toHaveBeenCalled();
  });

  it('marks wp_users_legacy as migrated with a migratedAt timestamp, without rewriting user_pass', async () => {
    await service.migrate(makeLegacy(), 'plain-pass');

    expect(tx.wpUserLegacy.update).toHaveBeenCalledWith({
      where: { id: 42n },
      data: { migrated: true, migratedAt: expect.any(Date) as Date },
    });
    const [{ data }] = tx.wpUserLegacy.update.mock.calls[0];
    expect((data as Record<string, unknown>).userPass).toBeUndefined();
  });

  it('returns the upserted user from the transaction', async () => {
    const upserted = makeUser({ id: 'new-uuid' });
    tx.user.upsert.mockResolvedValue(upserted);

    const result = await service.migrate(makeLegacy(), 'plain-pass');

    expect(result).toBe(upserted);
  });

  describe('with an existingUser (dispensable-password account)', () => {
    it('reuses the existing id and coalesces fullName/origin/isTeamOnly/role, changing only passwordHash + wpUserId', async () => {
      const existingUser = makeUser({
        id: 'existing-user-id',
        fullName: 'Kept Name',
        origin: 'admin_created',
        isTeamOnly: true,
        role: 'gerente',
      });

      await service.migrate(makeLegacy(), 'plain-pass', existingUser);

      // role já resolvido em existingUser: nenhuma consulta ao wp_posts_raw
      // com o filtro de resolução de papel (postType.in / postStatus).
      expect(tx.wpPostRaw.findFirst).not.toHaveBeenCalledWith({
        where: ROLE_LOOKUP_WHERE,
      });
      const [{ where, create }] = tx.user.upsert.mock.calls[0];
      expect(where).toEqual({ id: 'existing-user-id' });
      expect(create.fullName).toBe('Kept Name');
      expect(create.origin).toBe('admin_created');
      expect(create.isTeamOnly).toBe(true);
      expect(create.role).toBe('gerente');
      expect(create.wpUserId).toBe(42);
      expect(create.passwordHash).toMatch(/^\$2/);
    });
  });

  describe('role coalescing', () => {
    it('prefers existingUser.role over the wp lookup', async () => {
      tx.wpPostRaw.findFirst.mockResolvedValue({ id: 1n, postType: 'abrigo' });
      const existingUser = makeUser({ role: 'admin' });

      await service.migrate(makeLegacy(), 'plain-pass', existingUser);

      expect(tx.wpPostRaw.findFirst).not.toHaveBeenCalledWith({
        where: ROLE_LOOKUP_WHERE,
      });
      const [{ create }] = tx.user.upsert.mock.calls[0];
      expect(create.role).toBe('admin');
    });

    it('falls back to the wp-resolved role when existingUser.role is null', async () => {
      tx.wpPostRaw.findFirst.mockResolvedValue({ id: 1n, postType: 'abrigo' });
      const existingUser = makeUser({ role: null });

      await service.migrate(makeLegacy(), 'plain-pass', existingUser);

      const [{ create }] = tx.user.upsert.mock.calls[0];
      expect(create.role).toBe('abrigo');
    });

    it('is null when neither existingUser.role nor a wp post is found', async () => {
      await service.migrate(makeLegacy(), 'plain-pass');

      const [{ create }] = tx.user.upsert.mock.calls[0];
      expect(create.role).toBeNull();
    });
  });
});
