import {
  KEY_BADGE_CID,
  keyBadgeAttachment,
  logoAttachment,
} from './email-assets';
import type { EmailAttachment } from './email-assets';
import { renderEmailLayout } from './email-layout';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
}

export function passwordResetEmail(
  link: string,
  validityMinutes: number,
  siteUrl: string,
): EmailContent {
  const subject = 'Redefinição de senha - MV Abrigos Brasil';

  const html = renderEmailLayout({
    preheader: `Use o link para criar uma nova senha. Ele vale por ${validityMinutes} minutos.`,
    heading: 'Redefina sua senha',
    badgeCid: KEY_BADGE_CID,
    bodyHtml:
      '<p style="margin:0;">Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova senha.</p>',
    cta: { label: 'Redefinir minha senha', url: link },
    noteHtml: `<strong style="color:#4f5464;">O link expira em ${validityMinutes} minutos</strong> e só pode ser usado uma vez.<br>Se você não pediu essa alteração, ignore este e-mail: sua senha continua a mesma.`,
    siteUrl,
  });

  const text = [
    'Redefina sua senha - Medicina de Abrigos Brasil',
    '',
    'Recebemos um pedido para redefinir a senha da sua conta. Acesse o link abaixo para escolher uma nova senha:',
    link,
    '',
    `O link expira em ${validityMinutes} minutos e só pode ser usado uma vez.`,
    'Se você não pediu essa alteração, ignore este e-mail: sua senha continua a mesma.',
  ].join('\n');

  return {
    subject,
    html,
    text,
    attachments: [logoAttachment(), keyBadgeAttachment()],
  };
}
