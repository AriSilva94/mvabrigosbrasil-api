import { Logger } from '@nestjs/common';
import { MailService } from './mail.service';
import type { MailTransport } from './mail.service';

describe('MailService.sendPasswordReset', () => {
  it('sends via the injected SMTP transport with from = MAIL_FROM and the link in the html body', async () => {
    const send = jest.fn(
      (payload: {
        from: string;
        to: string;
        subject: string;
        html: string;
        text: string;
      }) => Promise.resolve({ data: { id: 'email-1' }, echo: payload }),
    );
    const fakeTransport: MailTransport = { sendMail: send };
    const config = {
      get: (key: string) =>
        key === 'MAIL_FROM'
          ? 'MV Abrigos <no-reply@mvabrigosbrasil.com.br>'
          : undefined,
    };

    const service = new MailService(fakeTransport, config as never);
    const link = 'http://localhost:3000/redefinir-senha?token=abc123';

    await service.sendPasswordReset('joao@example.com', link);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.to).toBe('joao@example.com');
    expect(payload.from).toBe('MV Abrigos <no-reply@mvabrigosbrasil.com.br>');
    expect(payload.html).toContain(`href="${link}"`);
    expect(payload.html).toContain('Redefinir minha senha');
    expect(payload.text).toContain(link);
  });

  it('does not throw and does not call send when there is no transport (dev without SMTP_HOST)', async () => {
    const config = {
      get: (key: string) =>
        key === 'MAIL_FROM'
          ? 'MV Abrigos <no-reply@mvabrigosbrasil.com.br>'
          : undefined,
    };
    const service = new MailService(null, config as never);
    const link = 'http://localhost:3000/redefinir-senha?token=abc123';

    await expect(
      service.sendPasswordReset('joao@example.com', link),
    ).resolves.toBeUndefined();
  });

  describe('without a transport (SMTP_HOST missing), guarded by NODE_ENV', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const config = {
      get: (key: string) =>
        key === 'MAIL_FROM'
          ? 'MV Abrigos <no-reply@mvabrigosbrasil.com.br>'
          : undefined,
    };

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv;
      jest.restoreAllMocks();
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
      const link = 'http://localhost:3000/redefinir-senha?token=abc123';

      await service.sendPasswordReset('joao@example.com', link);

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain(link);
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
      const link = 'http://localhost:3000/redefinir-senha?token=abc123';

      await expect(
        service.sendPasswordReset('joao@example.com', link),
      ).resolves.toBeUndefined();

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const warnArgs = warnSpy.mock.calls[0].join(' ');
      expect(warnArgs).not.toContain('abc123');
      expect(warnArgs).not.toContain(link);
    });
  });

  it('does not throw when the transport rejects (e.g. bad credentials/network error)', async () => {
    const send = jest.fn().mockRejectedValue(new Error('boom'));
    const fakeTransport: MailTransport = { sendMail: send };
    const config = {
      get: () => 'MV Abrigos <no-reply@mvabrigosbrasil.com.br>',
    };

    const service = new MailService(fakeTransport, config as never);

    await expect(
      service.sendPasswordReset(
        'joao@example.com',
        'http://x/redefinir-senha?token=t',
      ),
    ).resolves.toBeUndefined();
  });
});
