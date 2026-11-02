const BRAND_PRIMARY = '#108259';
const TEXT_COLOR = '#4f5464';
const MUTED_COLOR = '#696b7e';
const BACKGROUND = '#f5f5f6';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

// Clientes de e-mail ignoram CSS externo e <style> em vários casos, então o
// layout usa tabelas com estilos inline.
export function passwordResetEmail(
  link: string,
  validityMinutes: number,
): EmailContent {
  const subject = 'Redefinição de senha - MV Abrigos Brasil';

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:${BACKGROUND};font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BACKGROUND};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:${BRAND_PRIMARY};padding:24px 32px;color:#ffffff;font-size:20px;font-weight:bold;">
                Medicina de Abrigos Brasil
              </td>
            </tr>
            <tr>
              <td style="padding:32px;color:${TEXT_COLOR};font-size:16px;line-height:1.6;">
                <h1 style="margin:0 0 16px;font-size:22px;color:${TEXT_COLOR};">Redefinição de senha</h1>
                <p style="margin:0 0 16px;">Você solicitou a redefinição da sua senha. Clique no botão abaixo para escolher uma nova senha.</p>
                <p style="margin:24px 0;text-align:center;">
                  <a href="${link}" style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:6px;">Redefinir minha senha</a>
                </p>
                <p style="margin:0 0 16px;font-size:14px;color:${MUTED_COLOR};">Este link expira em ${validityMinutes} minutos e só pode ser usado uma vez.</p>
                <p style="margin:0 0 8px;font-size:13px;color:${MUTED_COLOR};">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
                <p style="margin:0;font-size:13px;word-break:break-all;"><a href="${link}" style="color:${BRAND_PRIMARY};">${link}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #e5e5e8;font-size:12px;color:${MUTED_COLOR};">
                Se você não solicitou essa alteração, ignore este e-mail: sua senha continua a mesma.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  const text = [
    'Redefinição de senha - Medicina de Abrigos Brasil',
    '',
    'Você solicitou a redefinição da sua senha. Acesse o link abaixo para escolher uma nova senha:',
    link,
    '',
    `Este link expira em ${validityMinutes} minutos e só pode ser usado uma vez.`,
    'Se você não solicitou essa alteração, ignore este e-mail.',
  ].join('\n');

  return { subject, html, text };
}
