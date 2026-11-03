import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { UsersService } from '../users/users.service';
import type { PasswordService } from './password/password.service';
import type { LegacyMigrationService } from './legacy-migration.service';
import type { SessionService } from '../redis/session.service';
import type { TokenService, Claims } from './jwt/token.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RedisService } from '../redis/redis.service';
import type { MailService } from '../mail/mail.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import type { User, WpUserLegacy } from '../generated/prisma/client';
import { findLegacyByEmail } from './legacy/legacy-email';

jest.mock('./legacy/legacy-email');
const findLegacyByEmailMock = jest.mocked(findLegacyByEmail);

beforeEach(() => {
  findLegacyByEmailMock.mockReset().mockResolvedValue([]);
});

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
  let passwordService: jest.Mocked<
    Pick<PasswordService, 'verify' | 'hash' | 'burnVerification'>
  >;
  let legacyMigrationService: jest.Mocked<
    Pick<LegacyMigrationService, 'migrate'>
  >;
  let sessionService: jest.Mocked<Pick<SessionService, 'create' | 'revokeAll'>>;
  let tokenService: jest.Mocked<Pick<TokenService, 'sign'>>;
  let prisma: {
    user: { updateMany: jest.Mock };
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
      burnVerification: jest.fn().mockResolvedValue(undefined),
    };
    legacyMigrationService = {
      migrate: jest.fn(),
    };
    sessionService = {
      create: jest.fn().mockResolvedValue({ sid: 'sid-1', rt: 'rt-1' }),
      revokeAll: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = {
      sign: jest.fn().mockResolvedValue('signed-jwt'),
    };
    prisma = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };

    service = new AuthService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      legacyMigrationService as unknown as LegacyMigrationService,
      sessionService as unknown as SessionService,
      tokenService as unknown as TokenService,
      prisma as unknown as PrismaService,
      {} as unknown as RedisService,
      {} as unknown as MailService,
      {} as unknown as ConfigService<Env, true>,
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
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
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
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: user.id, passwordHash: user.passwordHash },
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
    prisma.user.updateMany.mockRejectedValue(new Error('db down'));

    const result = await service.login('joao@example.com', 'secret');

    expect(result.migrated).toBe(true);
    expect(result.userId).toBe(user.id);
  });

  it('R2: no user password / R1 fails, legacy migrated=false and password valid -> migrates', async () => {
    const legacy = makeLegacy();
    usersService.findByEmail.mockResolvedValue(null);
    findLegacyByEmailMock.mockResolvedValue([legacy]);
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

  it('R2 over an existing users row revokes the sessions opened with the previous password', async () => {
    const user = makeUser({ passwordHash: 'other-hash' });
    usersService.findByEmail.mockResolvedValue(user);
    findLegacyByEmailMock.mockResolvedValue([makeLegacy()]);
    passwordService.verify
      .mockResolvedValueOnce({ valid: false, needsRehash: false })
      .mockResolvedValueOnce({ valid: true, needsRehash: true });
    legacyMigrationService.migrate.mockResolvedValue(user);

    await service.login('joao@example.com', 'wp-secret');

    expect(sessionService.revokeAll).toHaveBeenCalledWith(user.id);
    expect(sessionService.revokeAll.mock.invocationCallOrder[0]).toBeLessThan(
      sessionService.create.mock.invocationCallOrder[0],
    );
  });

  it('R3: legacy migrated=true -> does NOT consult user_pass, 401 on wrong/legacy-only password', async () => {
    const legacy = makeLegacy({ migrated: true });
    usersService.findByEmail.mockResolvedValue(null);
    findLegacyByEmailMock.mockResolvedValue([legacy]);

    await expect(
      service.login('joao@example.com', 'old-wp-password'),
    ).rejects.toMatchObject({ status: 401 });

    expect(passwordService.verify).not.toHaveBeenCalled();
    expect(legacyMigrationService.migrate).not.toHaveBeenCalled();
  });

  it('R4: 401 generic error when user exists but password is wrong (bcrypt already spent the time)', async () => {
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
      response: { error: 'E-mail ou senha inválidos.' },
    });
    expect(passwordService.burnVerification).not.toHaveBeenCalled();
  });

  it('R4: 401 generic error when only legacy exists but password is wrong', async () => {
    const legacy = makeLegacy();
    usersService.findByEmail.mockResolvedValue(null);
    findLegacyByEmailMock.mockResolvedValue([legacy]);
    passwordService.verify.mockResolvedValue({
      valid: false,
      needsRehash: false,
    });

    await expect(
      service.login('joao@example.com', 'wrong'),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'E-mail ou senha inválidos.' },
    });
    expect(passwordService.burnVerification).toHaveBeenCalledWith('wrong');
  });

  it('R4: unknown e-mail gets the same 401 as a wrong password and spends a bcrypt', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    findLegacyByEmailMock.mockResolvedValue([]);

    await expect(
      service.login('ninguem@example.com', 'whatever'),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'E-mail ou senha inválidos.' },
    });
    expect(passwordService.burnVerification).toHaveBeenCalledWith('whatever');
  });

  it('rejects passwords over 256 chars before looking the e-mail up', async () => {
    await expect(
      service.login('joao@example.com', 'a'.repeat(257)),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'E-mail ou senha inválidos.' },
    });
    expect(usersService.findByEmail).not.toHaveBeenCalled();
    expect(passwordService.verify).not.toHaveBeenCalled();
  });
});

function makeClaims(overrides: Partial<Claims> = {}): Claims {
  return {
    sub: 'actor-1',
    email: 'actor@example.com',
    role: 'admin',
    isTeamOnly: false,
    teamDisabled: false,
    creatorProfileId: null,
    sid: 'sid-actor',
    ...overrides,
  };
}

describe('AuthService.register', () => {
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmail'>>;
  let passwordService: jest.Mocked<Pick<PasswordService, 'hash'>>;
  let sessionService: jest.Mocked<Pick<SessionService, 'create'>>;
  let tokenService: jest.Mocked<Pick<TokenService, 'sign'>>;
  let prisma: { user: { findFirst: jest.Mock; create: jest.Mock } };
  let service: AuthService;

  beforeEach(() => {
    usersService = { findByEmail: jest.fn().mockResolvedValue(null) };
    passwordService = { hash: jest.fn().mockResolvedValue('hashed-pw') };
    sessionService = {
      create: jest.fn().mockResolvedValue({ sid: 'sid-1', rt: 'rt-1' }),
    };
    tokenService = { sign: jest.fn().mockResolvedValue('signed-jwt') };
    prisma = {
      user: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 'new-user-1' }),
      },
    };

    service = new AuthService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      {} as unknown as LegacyMigrationService,
      sessionService as unknown as SessionService,
      tokenService as unknown as TokenService,
      prisma as unknown as PrismaService,
      {} as unknown as RedisService,
      {} as unknown as MailService,
      {} as unknown as ConfigService<Env, true>,
    );
  });

  it('400 when email is missing', async () => {
    await expect(
      service.register({ email: '', password: 'secretpw' }, null),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'E-mail e senha são obrigatórios.' },
    });
  });

  it('400 when password is missing', async () => {
    await expect(
      service.register({ email: 'a@b.com', password: '  ' }, null),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'E-mail e senha são obrigatórios.' },
    });
  });

  it('400 when password is shorter than 8 characters', async () => {
    await expect(
      service.register({ email: 'a@b.com', password: '1234567' }, null),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'A senha deve ter pelo menos 8 caracteres.' },
    });
  });

  it('409 when e-mail already exists (case-insensitive)', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 'existing',
    } as unknown as User);

    await expect(
      service.register(
        { email: 'JOAO@Example.com', password: 'secretpw' },
        null,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'E-mail já cadastrado.' },
    });
    expect(usersService.findByEmail).toHaveBeenCalledWith('joao@example.com');
  });

  it('401 when teamOnly=true and no session', async () => {
    await expect(
      service.register(
        { email: 'a@b.com', password: 'secretpw', teamOnly: true },
        null,
      ),
    ).rejects.toMatchObject({
      status: 401,
      response: {
        error: 'É necessário estar logado para criar acessos da equipe.',
      },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('teamOnly=true with session: creatorProfileId=actor, origin=admin_created, isTeamOnly=true, no cookies emitted', async () => {
    const actor = makeClaims({ sub: 'actor-42', role: 'abrigo' });

    const result = await service.register(
      { email: 'novo@b.com', password: 'secretpw', teamOnly: true },
      actor,
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'novo@b.com',
        creatorProfileId: 'actor-42',
        origin: 'admin_created',
        isTeamOnly: true,
        emailVerified: true,
      }) as unknown,
    });
    expect(result.teamOnly).toBe(true);
    expect(result.userId).toBe('new-user-1');
    expect(result.at).toBeUndefined();
    expect(result.rt).toBeUndefined();
    expect(sessionService.create).not.toHaveBeenCalled();
    expect(tokenService.sign).not.toHaveBeenCalled();
  });

  it.each(['admin', 'gerente', ' Admin '])(
    '400 when self-registering with the privileged registerType %p',
    async (registerType) => {
      await expect(
        service.register(
          { email: 'x@y.com', password: 'secretpw', registerType },
          null,
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { error: 'Tipo de cadastro inválido.' },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a voluntario', makeClaims({ role: 'voluntario' })],
    ['an admin', makeClaims({ role: 'admin' })],
    ['a team member', makeClaims({ role: 'abrigo', isTeamOnly: true })],
    [
      'a disabled team member',
      makeClaims({ role: 'abrigo', teamDisabled: true }),
    ],
  ])('403 when %s tries to create a team access', async (_label, actor) => {
    await expect(
      service.register(
        { email: 'novo@b.com', password: 'secretpw', teamOnly: true },
        actor,
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { error: 'Sem permissão para criar acessos da equipe.' },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('teamOnly ignores the requested registerType and always creates an abrigo access', async () => {
    await service.register(
      {
        email: 'novo@b.com',
        password: 'secretpw',
        teamOnly: true,
        registerType: 'voluntario',
      },
      makeClaims({ role: 'abrigo' }),
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'abrigo' }) as unknown,
    });
  });

  it('409 when the e-mail belongs to a WordPress legacy account', async () => {
    findLegacyByEmailMock.mockResolvedValue([makeLegacy()]);

    await expect(
      service.register(
        { email: 'joao@example.com', password: 'secretpw' },
        null,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'E-mail já cadastrado.' },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it.each(['%', 'nao-e-email', 'a@b', `${'a'.repeat(250)}@x.com`])(
    '400 for the invalid e-mail %p',
    async (email) => {
      await expect(
        service.register({ email, password: 'secretpw' }, null),
      ).rejects.toMatchObject({
        status: 400,
        response: { error: 'E-mail inválido.' },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    },
  );

  it('400 when the password exceeds the 72 bytes bcrypt can use', async () => {
    await expect(
      service.register({ email: 'x@y.com', password: 'á'.repeat(37) }, null),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'A senha deve ter no máximo 72 caracteres.' },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('normal register (no teamOnly): origin=supabase_native, creatorProfileId=null, emits session', async () => {
    const result = await service.register(
      { email: 'Novo@B.com', password: 'secretpw', registerType: 'voluntario' },
      null,
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'novo@b.com',
        creatorProfileId: null,
        origin: 'supabase_native',
        isTeamOnly: false,
        role: 'voluntario',
        emailVerified: true,
        passwordHash: 'hashed-pw',
      }) as unknown,
    });
    expect(result.teamOnly).toBe(false);
    expect(result.userId).toBe('new-user-1');
    expect(result.at).toBe('signed-jwt');
    expect(result.rt).toBe('rt-1');
    expect(result.sid).toBe('sid-1');
    expect(sessionService.create).toHaveBeenCalledWith('new-user-1');
  });

  it('invalid/absent registerType falls back to abrigo', async () => {
    await service.register(
      { email: 'x@y.com', password: 'secretpw', registerType: 'nonsense' },
      null,
    );

    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: 'abrigo' }) as unknown,
    });
  });

  it('lowercases email before storing/checking', async () => {
    await service.register(
      { email: '  MAIUSCULO@Example.com  ', password: 'secretpw' },
      null,
    );

    expect(usersService.findByEmail).toHaveBeenCalledWith(
      'maiusculo@example.com',
    );
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'maiusculo@example.com',
      }) as unknown,
    });
  });
});

describe('AuthService.me', () => {
  let service: AuthService;

  beforeEach(() => {
    service = new AuthService(
      {} as unknown as UsersService,
      {} as unknown as PasswordService,
      {} as unknown as LegacyMigrationService,
      {} as unknown as SessionService,
      {} as unknown as TokenService,
      {} as unknown as PrismaService,
      {} as unknown as RedisService,
      {} as unknown as MailService,
      {} as unknown as ConfigService<Env, true>,
    );
  });

  it('returns user shape from claims', async () => {
    const claims = makeClaims({
      sub: 'user-9',
      email: 'user9@example.com',
      role: 'voluntario',
      isTeamOnly: true,
      teamDisabled: false,
      creatorProfileId: 'creator-1',
    });

    await expect(service.me(claims)).resolves.toEqual({
      user: {
        id: 'user-9',
        email: 'user9@example.com',
        role: 'voluntario',
        isTeamOnly: true,
        teamDisabled: false,
        creatorProfileId: 'creator-1',
      },
    });
  });

  it('401 when no session', async () => {
    await expect(service.me(null)).rejects.toMatchObject({
      status: 401,
      response: { error: 'Não autenticado' },
    });
  });
});

describe('AuthService.postLoginRedirect', () => {
  let prisma: {
    shelter: { findFirst: jest.Mock };
    volunteer: { findFirst: jest.Mock };
  };
  let service: AuthService;

  beforeEach(() => {
    prisma = {
      shelter: { findFirst: jest.fn().mockResolvedValue(null) },
      volunteer: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    service = new AuthService(
      {} as unknown as UsersService,
      {} as unknown as PasswordService,
      {} as unknown as LegacyMigrationService,
      {} as unknown as SessionService,
      {} as unknown as TokenService,
      prisma as unknown as PrismaService,
      {} as unknown as RedisService,
      {} as unknown as MailService,
      {} as unknown as ConfigService<Env, true>,
    );
  });

  it('401 when no session', async () => {
    await expect(service.postLoginRedirect(null)).rejects.toMatchObject({
      status: 401,
      response: { error: 'Não autenticado' },
    });
  });

  it('admin -> /painel without checking shelter/volunteer', async () => {
    const claims = makeClaims({ role: 'admin' });

    await expect(service.postLoginRedirect(claims)).resolves.toEqual({
      hasShelter: false,
      hasVolunteer: false,
      hasProfile: false,
      redirectTo: '/painel',
    });
    expect(prisma.shelter.findFirst).not.toHaveBeenCalled();
    expect(prisma.volunteer.findFirst).not.toHaveBeenCalled();
  });

  it('has shelter -> /painel', async () => {
    prisma.shelter.findFirst.mockResolvedValue({ id: 'shelter-1' });
    const claims = makeClaims({ role: 'abrigo', sub: 'user-1' });

    await expect(service.postLoginRedirect(claims)).resolves.toEqual({
      hasShelter: true,
      hasVolunteer: false,
      hasProfile: true,
      redirectTo: '/painel',
    });
    expect(prisma.shelter.findFirst).toHaveBeenCalledWith({
      where: { profileId: 'user-1' },
    });
  });

  it('has volunteer -> /painel', async () => {
    prisma.volunteer.findFirst.mockResolvedValue({ id: 'vol-1' });
    const claims = makeClaims({ role: 'voluntario', sub: 'user-2' });

    await expect(service.postLoginRedirect(claims)).resolves.toEqual({
      hasShelter: false,
      hasVolunteer: true,
      hasProfile: true,
      redirectTo: '/painel',
    });
    expect(prisma.volunteer.findFirst).toHaveBeenCalledWith({
      where: { ownerProfileId: 'user-2' },
    });
  });

  it('neither shelter nor volunteer -> /meu-cadastro', async () => {
    const claims = makeClaims({ role: 'voluntario', sub: 'user-3' });

    await expect(service.postLoginRedirect(claims)).resolves.toEqual({
      hasShelter: false,
      hasVolunteer: false,
      hasProfile: false,
      redirectTo: '/meu-cadastro',
    });
  });
});

// Task 9: POST /auth/refresh (doc 03 §7, §10; doc 05 §3.1).
describe('AuthService.refresh', () => {
  let usersService: jest.Mocked<Pick<UsersService, 'resolveRole'>>;
  let sessionService: jest.Mocked<
    Pick<SessionService, 'rotate' | 'getUserId' | 'revoke'>
  >;
  let tokenService: jest.Mocked<Pick<TokenService, 'sign'>>;
  let prisma: { user: { findUnique: jest.Mock } };
  let service: AuthService;

  beforeEach(() => {
    usersService = {
      resolveRole: jest.fn().mockResolvedValue('voluntario'),
    };
    sessionService = {
      rotate: jest.fn(),
      getUserId: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = {
      sign: jest.fn().mockResolvedValue('new-signed-jwt'),
    };
    prisma = {
      user: { findUnique: jest.fn() },
    };

    service = new AuthService(
      usersService as unknown as UsersService,
      {} as unknown as PasswordService,
      {} as unknown as LegacyMigrationService,
      sessionService as unknown as SessionService,
      tokenService as unknown as TokenService,
      prisma as unknown as PrismaService,
      {} as unknown as RedisService,
      {} as unknown as MailService,
      {} as unknown as ConfigService<Env, true>,
    );
  });

  it('rotates the session, reloads the user from the DB, and signs fresh claims', async () => {
    sessionService.rotate.mockResolvedValue({ rt: 'new-rt' });
    sessionService.getUserId.mockResolvedValue('user-1');
    const user = makeUser({ role: 'gerente', teamDisabled: true });
    prisma.user.findUnique.mockResolvedValue(user);
    usersService.resolveRole.mockResolvedValue('gerente');

    const result = await service.refresh('sid-1', 'old-rt');

    expect(sessionService.rotate).toHaveBeenCalledWith('sid-1', 'old-rt');
    expect(sessionService.getUserId).toHaveBeenCalledWith('sid-1');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
    expect(tokenService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-1',
        role: 'gerente',
        teamDisabled: true,
        sid: 'sid-1',
      }) as unknown,
    );
    expect(result).toEqual({
      at: 'new-signed-jwt',
      rt: 'new-rt',
      sid: 'sid-1',
    });
  });

  it('401 "Sessão expirada" when rotate returns null (invalid/reused/expired rt)', async () => {
    sessionService.rotate.mockResolvedValue(null);

    await expect(service.refresh('sid-1', 'stale-rt')).rejects.toMatchObject({
      response: { error: 'Sessão expirada' },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(tokenService.sign).not.toHaveBeenCalled();
  });

  it('401 and revokes the session when the user backing the sid no longer exists', async () => {
    sessionService.rotate.mockResolvedValue({ rt: 'new-rt' });
    sessionService.getUserId.mockResolvedValue('user-1');
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.refresh('sid-1', 'old-rt')).rejects.toMatchObject({
      response: { error: 'Sessão expirada' },
    });
    expect(sessionService.revoke).toHaveBeenCalledWith('sid-1');
    expect(tokenService.sign).not.toHaveBeenCalled();
  });
});

// Task 9: POST /auth/logout.
describe('AuthService.logout', () => {
  let sessionService: jest.Mocked<Pick<SessionService, 'revoke'>>;
  let service: AuthService;

  beforeEach(() => {
    sessionService = {
      revoke: jest.fn().mockResolvedValue(undefined),
    };

    service = new AuthService(
      {} as unknown as UsersService,
      {} as unknown as PasswordService,
      {} as unknown as LegacyMigrationService,
      sessionService as unknown as SessionService,
      {} as unknown as TokenService,
      {} as unknown as PrismaService,
      {} as unknown as RedisService,
      {} as unknown as MailService,
      {} as unknown as ConfigService<Env, true>,
    );
  });

  it('revokes the session for a known sid', async () => {
    await service.logout('sid-1');

    expect(sessionService.revoke).toHaveBeenCalledWith('sid-1');
  });

  it('is a no-op (does not throw) when sid is null', async () => {
    await expect(service.logout(null)).resolves.toBeUndefined();
    expect(sessionService.revoke).not.toHaveBeenCalled();
  });
});

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Task 10: doc 03 §10 / doc 05 §3.1 — recuperação de senha por e-mail.
describe('AuthService.forgotPassword', () => {
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmail'>>;
  let mailService: jest.Mocked<Pick<MailService, 'sendPasswordReset'>>;
  let redisClient: { set: jest.Mock };
  let redisService: { client: unknown };
  let config: { get: jest.Mock };
  let prisma: object;
  let service: AuthService;

  beforeEach(() => {
    usersService = { findByEmail: jest.fn() };
    mailService = {
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    };
    redisClient = { set: jest.fn().mockResolvedValue('OK') };
    redisService = { client: redisClient };
    config = { get: jest.fn().mockReturnValue('http://localhost:3000') };
    prisma = {};

    service = new AuthService(
      usersService as unknown as UsersService,
      {} as unknown as PasswordService,
      {} as unknown as LegacyMigrationService,
      {} as unknown as SessionService,
      {} as unknown as TokenService,
      prisma as unknown as PrismaService,
      redisService as unknown as RedisService,
      mailService as unknown as MailService,
      config as unknown as ConfigService<Env, true>,
    );
  });

  it('existing user: stores pwdreset:{sha256(token)} -> userId with TTL 60min, sends e-mail, returns {ok:true}', async () => {
    const user = makeUser({ id: 'user-1', email: 'joao@example.com' });
    usersService.findByEmail.mockResolvedValue(user);

    const result = await service.forgotPassword('joao@example.com');

    expect(result).toEqual({ ok: true });
    expect(redisClient.set).toHaveBeenCalledTimes(1);
    const [key, value, ex, ttl] = redisClient.set.mock.calls[0] as [
      string,
      string,
      string,
      number,
    ];
    expect(key).toMatch(/^pwdreset:[a-f0-9]{64}$/);
    expect(value).toBe('user-1');
    expect(ex).toBe('EX');
    expect(ttl).toBe(60 * 60);

    expect(mailService.sendPasswordReset).toHaveBeenCalledTimes(1);
    const [email, link] = mailService.sendPasswordReset.mock.calls[0];
    expect(email).toBe('joao@example.com');
    expect(link).toMatch(
      /^http:\/\/localhost:3000\/redefinir-senha\?token=[A-Za-z0-9_-]+$/,
    );

    // A chave gravada é o hash do token que está no link, nunca o token puro.
    const tokenInLink = new URL(link).searchParams.get('token') as string;
    expect(key).toBe(`pwdreset:${sha256(tokenInLink)}`);
  });

  it('builds the reset link without a double slash when APP_URL ends with "/"', async () => {
    config.get.mockReturnValue('https://dev.example.com/');
    usersService.findByEmail.mockResolvedValue(
      makeUser({ id: 'user-1', email: 'joao@example.com' }),
    );

    await service.forgotPassword('joao@example.com');

    const [, link] = mailService.sendPasswordReset.mock.calls[0];
    expect(link).toMatch(
      /^https:\/\/dev\.example\.com\/redefinir-senha\?token=[A-Za-z0-9_-]+$/,
    );
  });

  it('nonexistent user: still returns {ok:true}, does not store a token or send e-mail', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    const result = await service.forgotPassword('ninguem@example.com');

    expect(result).toEqual({ ok: true });
    expect(redisClient.set).not.toHaveBeenCalled();
    expect(mailService.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('legacy WordPress user without account: stores legacy:{id} and e-mails the legacy address', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    findLegacyByEmailMock.mockResolvedValue([
      makeLegacy({ id: 42n, userEmail: 'Joao@Example.com' }),
    ]);

    const result = await service.forgotPassword('joao@example.com');

    expect(result).toEqual({ ok: true });
    expect(findLegacyByEmailMock).toHaveBeenCalledWith(
      prisma,
      'joao@example.com',
      { pendingOnly: true },
    );
    const [key, value] = redisClient.set.mock.calls[0] as [string, string];
    expect(key).toMatch(/^pwdreset:[a-f0-9]{64}$/);
    expect(value).toBe('legacy:42');
    expect(mailService.sendPasswordReset).toHaveBeenCalledWith(
      'joao@example.com',
      expect.stringMatching(/\/redefinir-senha\?token=/),
    );
  });

  it('does not wait for the SMTP delivery (same response time with or without account)', async () => {
    usersService.findByEmail.mockResolvedValue(makeUser());
    mailService.sendPasswordReset.mockReturnValue(new Promise(() => {}));

    await expect(service.forgotPassword('joao@example.com')).resolves.toEqual({
      ok: true,
    });
    expect(mailService.sendPasswordReset).toHaveBeenCalledTimes(1);
  });

  it('always 200 even with an empty/blank e-mail', async () => {
    const result = await service.forgotPassword('   ');

    expect(result).toEqual({ ok: true });
    expect(usersService.findByEmail).not.toHaveBeenCalled();
  });
});

describe('AuthService.resetPassword', () => {
  let passwordService: jest.Mocked<Pick<PasswordService, 'hash'>>;
  let sessionService: jest.Mocked<Pick<SessionService, 'revokeAll'>>;
  let prisma: {
    user: { update: jest.Mock };
    wpUserLegacy: { findUnique: jest.Mock };
  };
  let redisClient: { get: jest.Mock; del: jest.Mock };
  let redisService: { client: unknown };
  let legacyMigrationService: { setPassword: jest.Mock; migrate: jest.Mock };
  let usersService: { findByEmail: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    passwordService = { hash: jest.fn().mockResolvedValue('new-bcrypt-hash') };
    sessionService = { revokeAll: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      user: { update: jest.fn().mockResolvedValue(undefined) },
      wpUserLegacy: { findUnique: jest.fn() },
    };
    redisClient = {
      get: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
    };
    redisService = { client: redisClient };
    usersService = { findByEmail: jest.fn().mockResolvedValue(null) };

    legacyMigrationService = {
      setPassword: jest.fn().mockResolvedValue(undefined),
      migrate: jest.fn(),
    };
    service = new AuthService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      legacyMigrationService as unknown as LegacyMigrationService,
      sessionService as unknown as SessionService,
      {} as unknown as TokenService,
      prisma as unknown as PrismaService,
      redisService as unknown as RedisService,
      {} as unknown as MailService,
      {} as unknown as ConfigService<Env, true>,
    );
  });

  it('valid token: updates passwordHash, deletes the reset key, revokes all sessions, returns {ok:true}', async () => {
    const token = 'plaintext-token-abc';
    redisClient.get.mockResolvedValue('user-1');

    const result = await service.resetPassword(token, 'newpassword123');

    expect(result).toEqual({ ok: true });
    expect(redisClient.get).toHaveBeenCalledWith(`pwdreset:${sha256(token)}`);
    expect(passwordService.hash).toHaveBeenCalledWith('newpassword123');
    expect(legacyMigrationService.setPassword).toHaveBeenCalledWith(
      'user-1',
      'new-bcrypt-hash',
      { claimLegacy: true },
    );
    expect(redisClient.del).toHaveBeenCalledWith(`pwdreset:${sha256(token)}`);
    expect(sessionService.revokeAll).toHaveBeenCalledWith('user-1');
  });

  it('legacy token: migrates the WordPress user with the new password and links posts', async () => {
    const token = 'legacy-token';
    const legacy = makeLegacy({ id: 42n, migrated: false });
    redisClient.get.mockResolvedValue('legacy:42');
    prisma.wpUserLegacy.findUnique.mockResolvedValue(legacy);
    legacyMigrationService.migrate.mockResolvedValue(
      makeUser({ id: 'migrated-user' }),
    );

    const result = await service.resetPassword(token, '  newpassword123 ');

    expect(result).toEqual({ ok: true });
    expect(prisma.wpUserLegacy.findUnique).toHaveBeenCalledWith({
      where: { id: 42n },
    });
    expect(legacyMigrationService.migrate).toHaveBeenCalledWith(
      legacy,
      'newpassword123',
      null,
    );
    expect(legacyMigrationService.setPassword).not.toHaveBeenCalled();
    expect(redisClient.del).toHaveBeenCalledWith(`pwdreset:${sha256(token)}`);
    expect(sessionService.revokeAll).toHaveBeenCalledWith('migrated-user');
  });

  it('legacy token after the user already migrated by login: sets the password on that account', async () => {
    redisClient.get.mockResolvedValue('legacy:42');
    prisma.wpUserLegacy.findUnique.mockResolvedValue(
      makeLegacy({ id: 42n, migrated: true }),
    );
    usersService.findByEmail.mockResolvedValue(makeUser({ id: 'user-1' }));

    await expect(
      service.resetPassword('legacy-token', 'newpassword123'),
    ).resolves.toEqual({ ok: true });

    expect(legacyMigrationService.migrate).not.toHaveBeenCalled();
    expect(legacyMigrationService.setPassword).toHaveBeenCalledWith(
      'user-1',
      'new-bcrypt-hash',
      { claimLegacy: true },
    );
    expect(sessionService.revokeAll).toHaveBeenCalledWith('user-1');
  });

  it('400 when the legacy record behind the token no longer exists', async () => {
    redisClient.get.mockResolvedValue('legacy:42');
    prisma.wpUserLegacy.findUnique.mockResolvedValue(null);

    await expect(
      service.resetPassword('legacy-token', 'newpassword123'),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'Link inválido ou expirado' },
    });
    expect(redisClient.del).not.toHaveBeenCalled();
  });

  it('400 when the new password exceeds 72 bytes', async () => {
    await expect(
      service.resetPassword('some-token', 'a'.repeat(73)),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'A senha deve ter no máximo 72 caracteres.' },
    });
    expect(redisClient.get).not.toHaveBeenCalled();
  });

  it('400 "Link inválido ou expirado" when token is absent/expired', async () => {
    redisClient.get.mockResolvedValue(null);

    await expect(
      service.resetPassword('missing-or-expired', 'newpassword123'),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'Link inválido ou expirado' },
    });
    expect(legacyMigrationService.setPassword).not.toHaveBeenCalled();
    expect(sessionService.revokeAll).not.toHaveBeenCalled();
  });

  it('400 when password is shorter than 6 characters (after trim)', async () => {
    await expect(
      service.resetPassword('some-token', '  12345 '),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'A senha deve ter no mínimo 6 caracteres.' },
    });
    expect(redisClient.get).not.toHaveBeenCalled();
  });
});

describe('AuthService.changePassword', () => {
  let passwordService: jest.Mocked<Pick<PasswordService, 'verify' | 'hash'>>;
  let sessionService: jest.Mocked<Pick<SessionService, 'revokeAll'>>;
  let prisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let legacyMigrationService: { setPassword: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    passwordService = {
      verify: jest.fn(),
      hash: jest.fn().mockResolvedValue('new-bcrypt-hash'),
    };
    sessionService = { revokeAll: jest.fn().mockResolvedValue(undefined) };
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };

    legacyMigrationService = {
      setPassword: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(
      {} as unknown as UsersService,
      passwordService as unknown as PasswordService,
      legacyMigrationService as unknown as LegacyMigrationService,
      sessionService as unknown as SessionService,
      {} as unknown as TokenService,
      prisma as unknown as PrismaService,
      {} as unknown as RedisService,
      {} as unknown as MailService,
      {} as unknown as ConfigService<Env, true>,
    );
  });

  it('401 "Não autenticado" when there is no session', async () => {
    await expect(
      service.changePassword(null, 'current', 'newpassword'),
    ).rejects.toMatchObject({
      status: 401,
      response: { error: 'Não autenticado' },
    });
  });

  it('400 "Senha atual incorreta." when the current password does not match', async () => {
    const claims = makeClaims({ sub: 'user-1', sid: 'sid-current' });
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ id: 'user-1', passwordHash: 'old-hash' }),
    );
    passwordService.verify.mockResolvedValue({
      valid: false,
      needsRehash: false,
    });

    await expect(
      service.changePassword(claims, 'wrong-current', 'newpassword'),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'Senha atual incorreta.' },
    });
    expect(legacyMigrationService.setPassword).not.toHaveBeenCalled();
    expect(sessionService.revokeAll).not.toHaveBeenCalled();
  });

  it('400 when the new password is shorter than 6 characters (after trim)', async () => {
    const claims = makeClaims({ sub: 'user-1', sid: 'sid-current' });
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ id: 'user-1', passwordHash: 'old-hash' }),
    );
    passwordService.verify.mockResolvedValue({
      valid: true,
      needsRehash: false,
    });

    await expect(
      service.changePassword(claims, 'current-ok', '  1234 '),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'A senha deve ter no mínimo 6 caracteres.' },
    });
    expect(legacyMigrationService.setPassword).not.toHaveBeenCalled();
  });

  it('400 when the new password exceeds 72 bytes', async () => {
    prisma.user.findUnique.mockResolvedValue(makeUser({ id: 'user-1' }));
    passwordService.verify.mockResolvedValue({
      valid: true,
      needsRehash: false,
    });

    await expect(
      service.changePassword(makeClaims(), 'current-ok', 'a'.repeat(73)),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'A senha deve ter no máximo 72 caracteres.' },
    });
    expect(legacyMigrationService.setPassword).not.toHaveBeenCalled();
  });

  it('success: updates passwordHash and revokes all sessions except the current one', async () => {
    const claims = makeClaims({ sub: 'user-1', sid: 'sid-current' });
    prisma.user.findUnique.mockResolvedValue(
      makeUser({ id: 'user-1', passwordHash: 'old-hash' }),
    );
    passwordService.verify.mockResolvedValue({
      valid: true,
      needsRehash: false,
    });

    const result = await service.changePassword(
      claims,
      'current-ok',
      'newpassword123',
    );

    expect(result).toEqual({ ok: true });
    expect(passwordService.hash).toHaveBeenCalledWith('newpassword123');
    expect(legacyMigrationService.setPassword).toHaveBeenCalledWith(
      'user-1',
      'new-bcrypt-hash',
      { claimLegacy: false },
    );
    expect(sessionService.revokeAll).toHaveBeenCalledWith(
      'user-1',
      'sid-current',
    );
  });
});
