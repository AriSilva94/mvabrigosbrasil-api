import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RedisService } from '../redis/redis.service';
import type { UsersService } from '../users/users.service';
import type { PasswordService } from './password/password.service';
import type { LegacyMigrationService } from './legacy-migration.service';
import type { SessionService } from '../redis/session.service';
import type { TokenService } from './jwt/token.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import type { User } from '../generated/prisma/client';

// Integration test against a REAL Redis (same instance/pattern used by
// `src/redis/session.service.spec.ts`: db 15 so it never collides with
// dev data on db 0). Proves the actual Redis round-trip for the
// `pwdreset:{sha256(token)}` key: TTL is set, a successful reset consumes
// it (single-use — reusing the same token afterwards is rejected), and an
// absent/expired key is rejected too (task-10 brief case 14).
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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

describe('AuthService password reset (integration, real Redis)', () => {
  let redis: RedisService;
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmail'>>;
  let passwordService: jest.Mocked<Pick<PasswordService, 'hash'>>;
  let sessionService: jest.Mocked<Pick<SessionService, 'revokeAll'>>;
  let mailService: jest.Mocked<Pick<MailService, 'sendPasswordReset'>>;
  let legacyMigrationService: { setPassword: jest.Mock };
  let config: { get: jest.Mock };
  let service: AuthService;

  beforeAll(async () => {
    redis = new RedisService({
      get: () => process.env.REDIS_TEST_URL ?? 'redis://localhost:6380/15',
    } as never);
    await redis.onModuleInit();
  });

  afterAll(async () => {
    await redis.onModuleDestroy();
  });

  afterEach(async () => {
    const keys = await redis.client.keys('pwdreset:*');
    if (keys.length > 0) {
      await redis.client.del(...keys);
    }
    jest.clearAllMocks();
  });

  beforeEach(() => {
    usersService = { findByEmail: jest.fn() };
    passwordService = { hash: jest.fn().mockResolvedValue('new-bcrypt-hash') };
    sessionService = { revokeAll: jest.fn().mockResolvedValue(undefined) };
    mailService = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    legacyMigrationService = {
      setPassword: jest.fn().mockResolvedValue(undefined),
    };
    config = { get: jest.fn().mockReturnValue('http://localhost:3000') };

    service = new AuthService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      legacyMigrationService as unknown as LegacyMigrationService,
      sessionService as unknown as SessionService,
      {} as unknown as TokenService,
      {} as unknown as PrismaService,
      redis,
      mailService as unknown as MailService,
      config as unknown as ConfigService<Env, true>,
    );
  });

  it('forgotPassword stores pwdreset:{sha256(token)} -> userId with a TTL close to 60min', async () => {
    const user = makeUser({ id: 'user-1', email: 'joao@example.com' });
    usersService.findByEmail.mockResolvedValue(user);

    await service.forgotPassword('joao@example.com');

    const link = mailService.sendPasswordReset.mock.calls[0][1];
    const token = new URL(link).searchParams.get('token') as string;
    const key = `pwdreset:${sha256(token)}`;

    const storedUserId = await redis.client.get(key);
    expect(storedUserId).toBe('user-1');

    const ttl = await redis.client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60 * 60);
  });

  it('resetPassword consumes the token: a second reset with the same token is rejected (single-use)', async () => {
    const user = makeUser({ id: 'user-1', email: 'joao@example.com' });
    usersService.findByEmail.mockResolvedValue(user);
    await service.forgotPassword('joao@example.com');

    const link = mailService.sendPasswordReset.mock.calls[0][1];
    const token = new URL(link).searchParams.get('token') as string;

    const first = await service.resetPassword(token, 'newpassword123');
    expect(first).toEqual({ ok: true });
    expect(legacyMigrationService.setPassword).toHaveBeenCalledWith(
      'user-1',
      'new-bcrypt-hash',
      { claimLegacy: true },
    );
    expect(sessionService.revokeAll).toHaveBeenCalledWith('user-1');

    const key = `pwdreset:${sha256(token)}`;
    expect(await redis.client.get(key)).toBeNull();

    // Reusing the same (now-consumed) token must be rejected.
    await expect(
      service.resetPassword(token, 'anotherpassword123'),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'Link inválido ou expirado' },
    });
  });

  it('resetPassword rejects an absent/expired token (case 14)', async () => {
    const user = makeUser({ id: 'user-1', email: 'joao@example.com' });
    usersService.findByEmail.mockResolvedValue(user);
    await service.forgotPassword('joao@example.com');

    const link = mailService.sendPasswordReset.mock.calls[0][1];
    const token = new URL(link).searchParams.get('token') as string;
    const key = `pwdreset:${sha256(token)}`;

    // Simulate expiry directly instead of waiting out the real 60min TTL.
    await redis.client.del(key);

    await expect(
      service.resetPassword(token, 'newpassword123'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.resetPassword(token, 'newpassword123'),
    ).rejects.toMatchObject({
      status: 400,
      response: { error: 'Link inválido ou expirado' },
    });
  });
});
