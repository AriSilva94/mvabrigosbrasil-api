import {
  KEY_BADGE_CID,
  keyBadgeAttachment,
  logoAttachment,
} from './email-assets';
import { renderEmailLayout } from './email-layout';
import type { EmailContent } from './password-reset.template';

export function emailVerificationEmail(
  link: string,
  validityHours: number,
  siteUrl: string,
): EmailContent {
  const subject = 'Confirme seu e-mail - MV Abrigos Brasil';

  const html = renderEmailLayout({
    preheader: `Confirme seu e-mail para ativar sua conta. O link vale por ${validityHours} horas.`,
    heading: 'Confirme seu e-mail',
    badgeCid: KEY_BADGE_CID,
    bodyHtml:
      '<p style="margin:0;">Bem-vindo(a) à Medicina de Abrigos Brasil! Para ativar sua conta e poder acessar a plataforma, confirme seu e-mail no botão abaixo.</p>',
    cta: { label: 'Confirmar meu e-mail', url: link },
    noteHtml: `<strong style="color:#4f5464;">O link expira em ${validityHours} horas</strong> e só pode ser usado uma vez.<br>Se você não criou uma conta, ignore este e-mail.`,
    siteUrl,
  });

  const text = [
    'Confirme seu e-mail - Medicina de Abrigos Brasil',
    '',
    'Para ativar sua conta, acesse o link abaixo:',
    link,
    '',
    `O link expira em ${validityHours} horas e só pode ser usado uma vez.`,
    'Se você não criou uma conta, ignore este e-mail.',
  ].join('\n');

  return {
    subject,
    html,
    text,
    attachments: [logoAttachment(), keyBadgeAttachment()],
  };
}
