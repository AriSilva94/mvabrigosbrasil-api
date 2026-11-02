import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import type { EmailAttachment } from './email-assets';
import { passwordResetEmail } from './password-reset.template';

export const MAIL_TRANSPORT = 'MAIL_TRANSPORT';

// Recorte do nodemailer que este serviço usa, para os testes injetarem um
// transporte falso sem depender dos tipos do pacote.
export interface MailTransport {
  sendMail(payload: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text: string;
    attachments: EmailAttachment[];
  }): Promise<unknown>;
}

// Mesmo prazo do TTL do token em AuthService (`PWD_RESET_TTL_SECONDS`).
const PASSWORD_RESET_VALIDITY_MINUTES = 60;

const DEFAULT_FROM = 'MV Abrigos <contato@mvabrigosbrasil.com.br>';
const DEFAULT_SITE_URL = 'https://mvabrigosbrasil.com.br';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  private readonly siteUrl: string;

  constructor(
    // `null` em dev/teste sempre que SMTP_HOST está ausente (ver a factory do
    // MailModule): sendPasswordReset só loga nesse caso e nunca lança.
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
    config: ConfigService<Env, true>,
  ) {
    this.from = config.get('MAIL_FROM', { infer: true }) ?? DEFAULT_FROM;
    const appUrl = config.get('APP_URL', { infer: true });
    this.siteUrl = appUrl ? new URL(appUrl).origin : DEFAULT_SITE_URL;
  }

  async sendPasswordReset(email: string, link: string): Promise<void> {
    const { subject, html, text, attachments } = passwordResetEmail(
      link,
      PASSWORD_RESET_VALIDITY_MINUTES,
      this.siteUrl,
    );

    if (!this.transport) {
      if (process.env.NODE_ENV !== 'production') {
        // Conveniência de dev/teste: sem SMTP_HOST, loga o link (com token)
        // para permitir seguir o fluxo manualmente. Nunca em produção.
        this.logger.log(
          `SMTP_HOST não configurado — link de redefinição de senha para ${email}: ${link}`,
        );
      } else {
        // Em produção, SMTP ausente é falha de configuração — nunca logar o
        // token em claro. Apenas avisa e segue (forgot-password nunca deve
        // falhar por causa do envio de e-mail).
        this.logger.warn(
          `SMTP_HOST não configurado em produção — e-mail de redefinição de senha para ${email} não pôde ser enviado`,
        );
      }
      return;
    }

    try {
      await this.transport.sendMail({
        from: this.from,
        to: email,
        subject,
        html,
        text,
        attachments,
      });
    } catch (err) {
      // forgot-password nunca deve falhar por causa de um problema no envio
      // de e-mail (doc 03 §10): loga e segue.
      this.logger.error(
        `Falha ao enviar e-mail de redefinição de senha para ${email}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
