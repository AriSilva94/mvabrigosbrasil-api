import { MailService } from './mail.service';
import type { ResendLikeClient } from './mail.service';

describe('MailService.sendPasswordReset', () => {
  it('sends via the injected Resend client with from = MAIL_FROM and the link in the html body', async () => {
    const send = jest.fn(
      (payload: { from: string; to: string; subject: string; html: string }) =>
        Promise.resolve({ data: { id: 'email-1' }, echo: payload }),
    );
    const fakeClient: ResendLikeClient = { emails: { send } };
    const config = {
      get: (key: string) =>
        key === 'MAIL_FROM'
          ? 'MV Abrigos <no-reply@mvabrigosbrasil.com.br>'
          : undefined,
    };

    const service = new MailService(fakeClient, config as never);
    const link = 'http://localhost:3000/redefinir-senha?token=abc123';

    await service.sendPasswordReset('joao@example.com', link);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.to).toBe('joao@example.com');
    expect(payload.from).toBe('MV Abrigos <no-reply@mvabrigosbrasil.com.br>');
    expect(payload.html).toContain(link);
  });

  it('does not throw and does not call send when there is no client (dev without RESEND_API_KEY)', async () => {
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

  it('does not throw when the Resend client rejects (e.g. invalid key/network error)', async () => {
    const send = jest.fn().mockRejectedValue(new Error('boom'));
    const fakeClient: ResendLikeClient = { emails: { send } };
    const config = {
      get: () => 'MV Abrigos <no-reply@mvabrigosbrasil.com.br>',
    };

    const service = new MailService(fakeClient, config as never);

    await expect(
      service.sendPasswordReset(
        'joao@example.com',
        'http://x/redefinir-senha?token=t',
      ),
    ).resolves.toBeUndefined();
  });
});
