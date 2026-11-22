import { MailService } from './mail.service';
import type { ResendLike } from './mail.service';
import { emailVerificationEmail } from './email-verification.template';
import { passwordChangedEmail } from './password-changed.template';

const SITE = 'https://x.test';

describe('emailVerificationEmail', () => {
  it('has the subject, the CTA and shows the validity in html and text', () => {
    const link = 'https://x.test/confirmar-email?token=t';

    const { subject, html, text } = emailVerificationEmail(link, 24, SITE);

    expect(subject).toBe('Confirme seu e-mail - MV Abrigos Brasil');
    expect(html).toContain('Confirmar meu e-mail');
    expect(html).toContain(`href="${link}"`);
    expect(html).toContain('24 horas');
    expect(text).toContain('24 horas');
    expect(text).toContain(link);
  });

  it('escapes the link so a crafted query cannot break the markup', () => {
    const { html } = emailVerificationEmail(
      'https://x.test/confirmar-email?token=a&b="><script>',
      24,
      SITE,
    );

    expect(html).not.toContain('<script>');
    expect(html).toContain('token=a&amp;b=&quot;&gt;&lt;script&gt;');
  });
});

describe('passwordChangedEmail', () => {
  it('warns the user and points the button to the recovery page', () => {
    const resetUrl = 'https://x.test/recuperar-senha';

    const { subject, html, text } = passwordChangedEmail(resetUrl, SITE);

    expect(subject).toBe('Sua senha foi alterada - MV Abrigos Brasil');
    expect(html).toContain('Não fui eu');
    expect(html).toContain(`href="${resetUrl}"`);
    expect(text).toContain(resetUrl);
  });
});

describe('MailService transactional sends', () => {
  const config = {
    get: (key: string) => {
      if (key === 'APP_URL') return 'https://x.test/qualquer/caminho';
      return undefined;
    },
  };

  function serviceWithSpy() {
    const send = jest.fn(() =>
      Promise.resolve({ data: { id: 'email-1' }, error: null }),
    );
    const client = { emails: { send } } as unknown as ResendLike;
    return { service: new MailService(client, config as never), send };
  }

  it('sendEmailVerification sends the verification subject with the link', async () => {
    const { service, send } = serviceWithSpy();
    const link = 'https://x.test/confirmar-email?token=t';

    await service.sendEmailVerification('maria@example.com', link);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = (send.mock.calls[0] as unknown[])[0] as {
      to: string;
      subject: string;
      html: string;
    };
    expect(payload.to).toBe('maria@example.com');
    expect(payload.subject).toBe('Confirme seu e-mail - MV Abrigos Brasil');
    expect(payload.html).toContain(`href="${link}"`);
  });

  it('sendPasswordChanged links to /recuperar-senha on the site origin', async () => {
    const { service, send } = serviceWithSpy();

    await service.sendPasswordChanged('maria@example.com');

    const payload = (send.mock.calls[0] as unknown[])[0] as {
      subject: string;
      html: string;
    };
    expect(payload.subject).toBe('Sua senha foi alterada - MV Abrigos Brasil');
    expect(payload.html).toContain('href="https://x.test/recuperar-senha"');
  });
});
