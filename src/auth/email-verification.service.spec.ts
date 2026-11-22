import { createHash } from 'crypto';
import { EmailVerificationService } from './email-verification.service';
import type { User } from '../generated/prisma/client';

const PASSWORD = 'senha-correta';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

class FakeRedisClient {
  readonly store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  getdel(key: string): Promise<string | null> {
    const value = this.store.get(key) ?? null;
    this.store.delete(key);
    return Promise.resolve(value);
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.store.delete(key) ? 1 : 0);
  }

  set(key: string, value: string, ...args: unknown[]): Promise<'OK' | null> {
    if (args.includes('NX') && this.store.has(key))
      return Promise.resolve(null);
    this.store.set(key, value);
    return Promise.resolve('OK');
  }
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'maria@example.com',
    emailVerified: false,
    passwordHash: 'hash-da-senha',
    ...overrides,
  } as User;
}

function setup(user: User | null = makeUser()) {
  const redis = new FakeRedisClient();
  const mail = {
    sendEmailVerification: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    user: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(user),
    },
  };
  const usersService = { findByEmail: jest.fn().mockResolvedValue(user) };
  const passwordService = {
    verify: jest.fn((plain: string) =>
      Promise.resolve({ valid: plain === PASSWORD, needsRehash: false }),
    ),
  };
  const config = { get: () => 'https://app.test/' };
  const service = new EmailVerificationService(
    { client: redis } as never,
    prisma as never,
    usersService as never,
    mail as never,
    config as never,
    passwordService as never,
  );
  return { service, redis, mail, prisma, usersService, passwordService };
}

function tokenFromLastMail(mail: { sendEmailVerification: jest.Mock }): string {
  const calls = mail.sendEmailVerification.mock.calls as [string, string][];
  const link = new URL(calls[calls.length - 1][1]);
  return link.searchParams.get('token') as string;
}

describe('EmailVerificationService', () => {
  it('issue stores only the sha256 of the token and mails a /confirmar-email link', async () => {
    const { service, redis, mail } = setup();

    await service.issue('user-1', 'maria@example.com');

    const [email, link] = mail.sendEmailVerification.mock.calls[0] as [
      string,
      string,
    ];
    expect(email).toBe('maria@example.com');
    expect(new URL(link).pathname).toBe('/confirmar-email');
    const token = tokenFromLastMail(mail);
    expect(redis.store.get(`emailverify:${sha256(token)}`)).toBe('user-1');
    expect([...redis.store.keys()].join(' ')).not.toContain(token);
  });

  it('confirm marks the user verified with the registration password and the same token cannot be reused', async () => {
    const { service, mail, prisma } = setup();
    await service.issue('user-1', 'maria@example.com');
    const token = tokenFromLastMail(mail);

    await expect(service.confirm(token, PASSWORD)).resolves.toBe('ok');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerified: true },
    });
    await expect(service.confirm(token, PASSWORD)).resolves.toBe('invalid');
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a wrong password does not verify the account and does not burn the link', async () => {
    const { service, mail, prisma } = setup();
    await service.issue('user-1', 'maria@example.com');
    const token = tokenFromLastMail(mail);

    await expect(service.confirm(token, 'senha-do-atacante')).resolves.toBe(
      'wrong_password',
    );
    expect(prisma.user.updateMany).not.toHaveBeenCalled();

    await expect(service.confirm(token, PASSWORD)).resolves.toBe('ok');
  });

  it('an account with no usable password cannot be confirmed through the link', async () => {
    const { service, mail, prisma } = setup(makeUser({ passwordHash: null }));
    await service.issue('user-1', 'maria@example.com');

    await expect(
      service.confirm(tokenFromLastMail(mail), PASSWORD),
    ).resolves.toBe('wrong_password');
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('a missing or oversized password is rejected before touching the hash', async () => {
    const { service, mail, passwordService } = setup();
    await service.issue('user-1', 'maria@example.com');
    const token = tokenFromLastMail(mail);

    await expect(service.confirm(token, '')).resolves.toBe('wrong_password');
    await expect(service.confirm(token, 'x'.repeat(1000))).resolves.toBe(
      'wrong_password',
    );
    expect(passwordService.verify).not.toHaveBeenCalled();
  });

  it('confirm returns invalid for an unknown token without touching the database', async () => {
    const { service, prisma } = setup();

    await expect(service.confirm('inventado', PASSWORD)).resolves.toBe(
      'invalid',
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('issuing again invalidates the previous link', async () => {
    const { service, mail } = setup();
    await service.issue('user-1', 'maria@example.com');
    const first = tokenFromLastMail(mail);
    await service.issue('user-1', 'maria@example.com');

    await expect(service.confirm(first, PASSWORD)).resolves.toBe('invalid');
    await expect(
      service.confirm(tokenFromLastMail(mail), PASSWORD),
    ).resolves.toBe('ok');
  });

  it('resend issues a link for an unverified account and respects the 60s cooldown', async () => {
    const { service, mail } = setup();

    await service.resend('Maria@Example.com ');
    await service.resend('maria@example.com');

    expect(mail.sendEmailVerification).toHaveBeenCalledTimes(1);
  });

  it('resend does nothing for unknown e-mails and already verified accounts', async () => {
    const unknown = setup(null);
    await expect(
      unknown.service.resend('x@example.com'),
    ).resolves.toBeUndefined();
    expect(unknown.mail.sendEmailVerification).not.toHaveBeenCalled();

    const verified = setup(makeUser({ emailVerified: true }));
    await verified.service.resend('maria@example.com');
    expect(verified.mail.sendEmailVerification).not.toHaveBeenCalled();
  });
});
