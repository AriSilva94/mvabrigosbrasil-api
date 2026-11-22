import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';
import type { ResendLike } from './mail.service';
import { passwordResetEmail } from './password-reset.template';

const FROM = 'MV Abrigos <no-reply@mail.mvabrigosbrasil.com.br>';
const LINK = 'http://localhost:3000/redefinir-senha?token=abc123';

type SentPayload = Parameters<ResendLike['emails']['send']>[0];

const config = {
  get: (key: string) => (key === 'MAIL_FROM' ? FROM : undefined),
};

function fakeClient(
  result: Awaited<ReturnType<ResendLike['emails']['send']>> = {
    data: { id: 'email-1' },
    error: null,
  },
) {
  const send = jest.fn((payload: SentPayload) => {
    void payload;
    return Promise.resolve(result);
  });
  return { client: { emails: { send } } as ResendLike, send };
}

describe('MailService.sendPasswordReset', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends via Resend with from = MAIL_FROM and the link in the html body', async () => {
    const { client, send } = fakeClient();
    const service = new MailService(client, config as never);

    await service.sendPasswordReset('joao@example.com', LINK);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.to).toBe('joao@example.com');
    expect(payload.from).toBe(FROM);
    expect(payload.html).toContain(`href="${LINK}"`);
    expect(payload.html).toContain('Redefinir minha senha');
    expect(payload.text).toContain(LINK);

    const attachments = payload.attachments ?? [];
    expect(attachments).toHaveLength(2);
    for (const { contentId, content } of attachments) {
      expect(payload.html).toContain(`cid:${contentId}`);
      expect(content.length).toBeGreaterThan(0);
    }
  });

  it('does not throw when Resend rejects (e.g. network error)', async () => {
    const send = jest.fn().mockRejectedValue(new Error('boom'));
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const service = new MailService({ emails: { send } }, config as never);

    await expect(
      service.sendPasswordReset('joao@example.com', LINK),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('logs and does not throw when Resend returns an error object instead of rejecting', async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: 'domain not verified' },
    });
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const service = new MailService(client, config as never);

    await expect(
      service.sendPasswordReset('joao@example.com', LINK),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0].join(' ')).toContain('domain not verified');
  });

  describe('without a client (RESEND_API_KEY missing), guarded by NODE_ENV', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('logs the reset link (with token) in non-production', async () => {
      process.env.NODE_ENV = 'test';
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const service = new MailService(null, config as never);

      await expect(
        service.sendPasswordReset('joao@example.com', LINK),
      ).resolves.toBeUndefined();

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain(LINK);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does NOT log the token in production, only a warning', async () => {
      process.env.NODE_ENV = 'production';
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      const service = new MailService(null, config as never);

      await expect(
        service.sendPasswordReset('joao@example.com', LINK),
      ).resolves.toBeUndefined();

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const warnArgs = warnSpy.mock.calls[0].join(' ');
      expect(warnArgs).not.toContain('abc123');
      expect(warnArgs).not.toContain(LINK);
    });
  });
});

describe('passwordResetEmail', () => {
  it('escapes the link in href and text so a crafted query cannot break the markup', () => {
    const link = 'https://x.test/redefinir-senha?token=a&b="><script>';

    const { html } = passwordResetEmail(link, 60, 'https://x.test');

    expect(html).not.toContain('<script>');
    expect(html).toContain('token=a&amp;b=&quot;&gt;&lt;script&gt;');
  });

  it('shows the validity in the preheader, body note and plain text', () => {
    const { html, text } = passwordResetEmail(
      'https://x.test/redefinir-senha?token=t',
      45,
      'https://x.test',
    );

    expect(html).toContain('45 minutos');
    expect(text).toContain('45 minutos');
  });
});
