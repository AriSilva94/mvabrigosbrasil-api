import { LOGO_CID } from './email-assets';

// Tokens do design system do site (globals.css). E-mail não lê CSS externo
// nem variáveis, então os valores são repetidos aqui e usados inline.
export const EMAIL_COLORS = {
  primary: '#108259',
  secondary: '#5e782a',
  accent: '#f2a400',
  text: '#696b7e',
  heading: '#4f5464',
  surface: '#f5f5f6',
  border: '#e8e8ec',
  white: '#ffffff',
};

const CONTACT_EMAIL = 'contato@mvabrigosbrasil.com.br';
const FONT_STACK = "Poppins,'Segoe UI',Helvetica,Arial,sans-serif";

export interface EmailLayoutOptions {
  // Texto de pré-visualização exibido ao lado do assunto na caixa de entrada.
  preheader: string;
  heading: string;
  badgeCid: string;
  bodyHtml: string;
  cta: { label: string; url: string };
  // Avisos curtos abaixo do botão (validade, segurança).
  noteHtml: string;
  siteUrl: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderEmailLayout(options: EmailLayoutOptions): string {
  const { preheader, heading, badgeCid, bodyHtml, cta, noteHtml, siteUrl } =
    options;
  const c = EMAIL_COLORS;
  const url = escapeHtml(cta.url);

  return `
<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(heading)}</title>
    <style>
      @media only screen and (max-width:620px) {
        .mv-card-pad { padding-left:24px !important; padding-right:24px !important; }
        .mv-heading { font-size:22px !important; }
        .mv-cta-cell { display:block !important; width:100% !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${c.surface};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${c.surface};font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.surface}" style="background:${c.surface};">
      <tr>
        <td align="center" style="padding:32px 16px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
            <tr>
              <td style="background:${c.white};border:1px solid ${c.border};border-radius:16px;overflow:hidden;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td height="4" bgcolor="${c.primary}" width="62%" style="height:4px;line-height:4px;font-size:0;">&nbsp;</td>
                    <td height="4" bgcolor="${c.secondary}" width="24%" style="height:4px;line-height:4px;font-size:0;">&nbsp;</td>
                    <td height="4" bgcolor="${c.accent}" width="14%" style="height:4px;line-height:4px;font-size:0;">&nbsp;</td>
                  </tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="mv-card-pad" style="padding:36px 48px 0;">
                      <a href="${escapeHtml(siteUrl)}" style="text-decoration:none;">
                        <img src="cid:${LOGO_CID}" width="180" alt="Medicina de Abrigos Brasil" style="display:block;border:0;width:180px;height:auto;">
                      </a>
                    </td>
                  </tr>
                  <tr>
                    <td class="mv-card-pad" style="padding:40px 48px 0;font-family:${FONT_STACK};">
                      <img src="cid:${badgeCid}" width="72" height="72" alt="" style="display:block;border:0;width:72px;height:72px;margin:0 0 24px;">
                      <h1 class="mv-heading" style="margin:0 0 16px;font-family:${FONT_STACK};font-size:26px;line-height:1.3;font-weight:600;color:${c.heading};">${escapeHtml(heading)}</h1>
                      <div style="font-size:16px;line-height:1.7;color:${c.text};">${bodyHtml}</div>
                    </td>
                  </tr>
                  <tr>
                    <td class="mv-card-pad" style="padding:32px 48px 0;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td class="mv-cta-cell" align="center" bgcolor="${c.primary}" style="background:${c.primary};border-radius:20px;">
                            <a href="${url}" style="display:inline-block;padding:14px 32px;font-family:${FONT_STACK};font-size:15px;font-weight:600;line-height:1.2;color:${c.white};text-decoration:none;border-radius:20px;">${escapeHtml(cta.label)}</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="mv-card-pad" style="padding:28px 48px 0;font-family:${FONT_STACK};">
                      <div style="background:${c.surface};border-radius:12px;padding:16px 20px;font-size:14px;line-height:1.6;color:${c.text};">${noteHtml}</div>
                    </td>
                  </tr>
                  <tr>
                    <td class="mv-card-pad" style="padding:24px 48px 40px;font-family:${FONT_STACK};font-size:13px;line-height:1.6;color:${c.text};">
                      Se o botão não funcionar, copie e cole este endereço no navegador:<br>
                      <a href="${url}" style="color:${c.primary};word-break:break-all;">${url}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 16px 0;font-family:${FONT_STACK};font-size:12px;line-height:1.7;color:${c.text};">
                <strong style="color:${c.heading};">Medicina de Abrigos Brasil</strong><br>
                Infodados de Abrigos de Animais<br>
                <a href="${escapeHtml(siteUrl)}" style="color:${c.primary};text-decoration:none;">${escapeHtml(siteUrl.replace(/^https?:\/\//, ''))}</a>
                &nbsp;·&nbsp;
                <a href="mailto:${CONTACT_EMAIL}" style="color:${c.primary};text-decoration:none;">${CONTACT_EMAIL}</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}
