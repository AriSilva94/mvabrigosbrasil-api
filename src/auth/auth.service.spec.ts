import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { UsersService } from '../users/users.service';
import type { PasswordService } from './password/password.service';
import type { LegacyMigrationService } from './legacy-migration.service';
import type { SessionService } from '../redis/session.service';
import type { TokenService } from './jwt/token.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { User, WpUserLegacy } from '../generated/prisma/client';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'joao@example.com',
    passwordHash: '$2a$04$abcdefghijklmnopqrstuv',
    emailVerified: true,
    fullName: 'Joao',
    phone: null,
    role: 'voluntario',
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

function makeLegacy(overrides: Partial<WpUserLegacy> = {}): WpUserLegacy {
  return {
    id: 42n,
    userLogin: 'joao',
    userEmail: 'joao@example.com',
    userPass: '$P$Bwordpressphpasshash',
    displayName: 'Joao Legacy',
    migrated: false,
    migratedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AuthService.login', () => {
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByEmail' | 'resolveRole'>
  >;
  let passwordService: jest.Mocked<Pick<PasswordService, 'verify' | 'hash'>>;
  let legacyMigrationService: jest.Mocked<
    Pick<LegacyMigrationService, 'migrate'>
  >;
  let sessionService: jest.Mocked<Pick<SessionService, 'create'>>;
  let tokenService: jest.Mocked<Pick<TokenService, 'sign'>>;
  let prisma: {
    wpUserLegacy: { findFirst: jest.Mock };
    user: { update: jest.Mock };
  };
  let service: AuthService;

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      resolveRole: jest.fn().mockResolvedValue('voluntario'),
    };
    passwordService = {
      verify: jest.fn(),
      hash: jest.fn().mockResolvedValue('new-bcrypt-hash'),
    };
    legacyMigrationService = {
      migrate: jest.fn(),
    };
    sessionService = {
      create: jest.fn().mockResolvedValue({ sid: 'sid-1', rt: 'rt-1' }),
    };
    tokenService = {
      sign: jest.fn().mockResolvedValue('signed-jwt'),
    };
    prisma = {
      wpUserLegacy: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { update: jest.fn().mockResolvedValue(undefined) },
    };

    service = new AuthService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      legacyMigrationService as unknown as LegacyMigrationService,
      sessionService as unknown as SessionService,
      tokenService as unknown as TokenService,
      prisma as unknown as PrismaService,
    );
  });

  it('400 when email is missing', async () => {
    await expect(service.login('', 'secret')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.login('', 'secret')).rejects.toMatchObject({
      response: { error: 'E-mail e senha são obrigatórios' },
    });
  });

  it('400 when password is missing', async () => {
    await expect(service.login('joao@example.com', '   ')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('R1: valid bcrypt password, no rehash needed -> logs in without updating user', async () => {
    const user = makeUser();
    usersService.findByEmail.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue({
      valid: true,
      needsRehash: false,
    });

    const result = await service.login('joao@example.com', 'secret');

    expect(result.migrated).toBe(true);
    expect(result.userId).toBe(user.id);
    expect(result.role).toBe('voluntario');
    expect(result.sid).toBe('sid-1');
    expect(result.rt).toBe('rt-1');
    expect(result.at).toBe('signed-jwt');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(legacyMigrationService.migrate).not.toHaveBeenCalled();
    expect(sessionService.create).toHaveBeenCalledWith(user.id);
  });

  it('R1: valid password with needsRehash -> rewrites passwordHash then logs in', async () => {
    const user = makeUser({ passwordHash: '$wp$2y$10$oldwphash' });
    usersService.findByEmail.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue({
      valid: true,
      needsRehash: true,
    });

    const result = await service.login('joao@example.com', 'secret');

    expect(result.migrated).toBe(true);
    expect(passwordService.hash).toHaveBeenCalledWith('secret');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: user.id },
      data: { passwordHash: 'new-bcrypt-hash' },
    });
  });

  it('R1: rehash failure does not block login', async () => {
    const user = makeUser({ passwordHash: '$wp$2y$10$oldwphash' });
    usersService.findByEmail.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue({
      valid: true,
      needsRehash: true,
    });
    prisma.user.update.mockRejectedValue(new Error('db down'));

    const result = await service.login('joao@example.com', 'secret');

    expect(result.migrated).toBe(true);
    expect(result.userId).toBe(user.id);
  });

  it('R2: no user password / R1 fails, legacy migrated=false and password valid -> migrates', async () => {
    const legacy = makeLegacy();
    usersService.findByEmail.mockResolvedValue(null);
    prisma.wpUserLegacy.findFirst.mockResolvedValue(legacy);
    passwordService.verify.mockResolvedValue({
      valid: true,
      needsRehash: true,
    });
    const migratedUser = makeUser({ id: 'migrated-1' });
    legacyMigrationService.migrate.mockResolvedValue(migratedUser);

    const result = await service.login('joao@example.com', 'secret');

    expect(result.migrated).toBe(false);
    expect(result.userId).toBe('migrated-1');
    expect(legacyMigrationService.migrate).toHaveBeenCalledWith(
      legacy,
      'secret',
      null,
    );
    expect(sessionService.create).toHaveBeenCalledWith('migrated-1');
  });

  it('R3: legacy migrated=true -> does NOT consult user_pass, 401 on wrong/legacy-only password', async () => {
    const legacy = makeLegacy({ migrated: true });
    usersService.findByEmail.mockResolvedValue(null);
    prisma.wpUserLegacy.findFirst.mockResolvedValue(legacy);

    await expect(
      service.login('joao@example.com', 'old-wp-password'),
    ).rejects.toMatchObject({ status: 401 });

    expect(passwordService.verify).not.toHaveBeenCalled();
    expect(legacyMigrationService.migrate).not.toHaveBeenCalled();
  });

  it('R4: 401 Senha inválida when user exists but password is wrong', async () => {
    const user = makeUser();
    usersService.findByEmail.mockResolvedValue(user);
    passwordService.verify.mockResolvedValue({
      valid: false,
      needsRehash: false,
    });

    await expect(
      service.login('joao@example.com', 'wrong'),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'Senha inválida' },
    });
  });

  it('R4: 401 Senha inválida when only legacy exists but password is wrong', async () => {
    const legacy = makeLegacy();
    usersService.findByEmail.mockResolvedValue(null);
    prisma.wpUserLegacy.findFirst.mockResolvedValue(legacy);
    passwordService.verify.mockResolvedValue({
      valid: false,
      needsRehash: false,
    });

    await expect(
      service.login('joao@example.com', 'wrong'),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'Senha inválida' },
    });
  });

  it('R4: 404 Usuário não encontrado when neither user nor legacy exists', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    prisma.wpUserLegacy.findFirst.mockResolvedValue(null);

    await expect(
      service.login('ninguem@example.com', 'whatever'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.login('ninguem@example.com', 'whatever'),
    ).rejects.toMatchObject({
      status: 404,
      response: { error: 'Usuário não encontrado' },
    });
  });
});
