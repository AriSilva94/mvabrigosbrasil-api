import {
  KEY_BADGE_CID,
  keyBadgeAttachment,
  logoAttachment,
} from './email-assets';
import { renderEmailLayout } from './email-layout';
import type { EmailContent } from './password-reset.template';

export function passwordChangedEmail(
  resetUrl: string,
  siteUrl: string,
): EmailContent {
  const subject = 'Sua senha foi alterada - MV Abrigos Brasil';

  const html = renderEmailLayout({
    preheader: 'A senha da sua conta foi alterada.',
    heading: 'Sua senha foi alterada',
    badgeCid: KEY_BADGE_CID,
    bodyHtml:
      '<p style="margin:0;">A senha da sua conta acabou de ser alterada. Se foi você, não precisa fazer nada.</p>',
    cta: { label: 'Não fui eu', url: resetUrl },
    noteHtml:
      'Se você não fez essa alteração, redefina sua senha agora pelo botão acima e entre em contato com a gente.',
    siteUrl,
  });

  const text = [
    'Sua senha foi alterada - Medicina de Abrigos Brasil',
    '',
    'A senha da sua conta acabou de ser alterada. Se foi você, não precisa fazer nada.',
    'Se não foi você, redefina sua senha agora:',
    resetUrl,
  ].join('\n');

  return {
    subject,
    html,
    text,
    attachments: [logoAttachment(), keyBadgeAttachment()],
  };
}
