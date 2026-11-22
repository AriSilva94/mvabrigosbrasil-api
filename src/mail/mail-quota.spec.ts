import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';

const LINK = 'https://x.test/token?t=1';

function setup(options: { limit?: number; used: number }) {
  let used = options.used;
  const redis = {
    client: {
      incr: jest.fn(() => Promise.resolve(++used)),
      decr: jest.fn(() => Promise.resolve(--used)),
      expire: jest.fn(() => Promise.resolve(1)),
    },
  };
  const send = jest.fn(() =>
    Promise.resolve({ data: { id: 'email-1' }, error: null }),
  );
  const config = {
    get: (key: string) =>
      key === 'MAIL_DAILY_LIMIT' ? options.limit : undefined,
  };
  const service = new MailService(
    { emails: { send } },
    config as never,
    redis as never,
  );
  return { service, send, redis, getUsed: () => used };
}

describe('MailService daily quota', () => {
  let warnSpy: jest.SpyInstance<
    void,
    [message: unknown, ...optional: unknown[]]
  >;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends while under the cap', async () => {
    const { service, send } = setup({ limit: 10, used: 0 });

    await service.sendEmailVerification('a@b.com', LINK);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses verification e-mails once the standard share (70%) is used, without counting the refusal', async () => {
    const { service, send, getUsed } = setup({ limit: 10, used: 7 });

    await service.sendEmailVerification('a@b.com', LINK);

    expect(send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(getUsed()).toBe(7);
  });

  it('still sends the password reset when only the reserved share is left', async () => {
    const { service, send } = setup({ limit: 10, used: 7 });

    await service.sendPasswordReset('a@b.com', LINK);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('refuses even the password reset when the whole daily cap is used', async () => {
    const { service, send } = setup({ limit: 10, used: 10 });

    await service.sendPasswordReset('a@b.com', LINK);

    expect(send).not.toHaveBeenCalled();
  });

  it('refuses the password-changed notice with the standard share', async () => {
    const { service, send } = setup({ limit: 10, used: 8 });

    await service.sendPasswordChanged('a@b.com');

    expect(send).not.toHaveBeenCalled();
  });

  it('does not block sending when Redis fails', async () => {
    const { service, send, redis } = setup({ limit: 10, used: 0 });
    redis.client.incr.mockRejectedValue(new Error('redis down'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await service.sendPasswordReset('a@b.com', LINK);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('defaults to the free plan cap of 100 per day when MAIL_DAILY_LIMIT is not set', async () => {
    const { service, send } = setup({ used: 99 });

    await service.sendPasswordReset('a@b.com', LINK);
    expect(send).toHaveBeenCalledTimes(1);

    await service.sendPasswordReset('a@b.com', LINK);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
