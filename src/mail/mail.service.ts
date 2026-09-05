import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';

export const RESEND_CLIENT = 'RESEND_CLIENT';

// Minimal shape of the Resend SDK surface this service actually uses, so
// tests can inject a fake client without depending on the real `resend`
// package's types.
export interface ResendLikeClient {
  emails: {
    send(payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
    }): Promise<unknown>;
  };
}

const DEFAULT_FROM = 'MV Abrigos <no-reply@mvabrigosbrasil.com.br>';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;

  constructor(
    // `null` in dev/test whenever RESEND_API_KEY is absent/empty (see
    // MailModule's factory) — sendPasswordReset logs instead of sending in
    // that case, and never throws either way.
    @Inject(RESEND_CLIENT) private readonly client: ResendLikeClient | null,
    config: ConfigService<Env, true>,
  ) {
    this.from = config.get('MAIL_FROM', { infer: true }) ?? DEFAULT_FROM;
  }

  async sendPasswordReset(email: string, link: string): Promise<void> {
    const subject = 'Redefinição de senha - MV Abrigos Brasil';
    const html = `
      <p>Você solicitou a redefinição da sua senha.</p>
      <p>Clique no link abaixo para escolher uma nova senha. Este link expira em 60 minutos e só pode ser usado uma vez.</p>
      <p><a href="${link}">${link}</a></p>
      <p>Se você não solicitou essa alteração, ignore este e-mail.</p>
    `.trim();

    if (!this.client) {
      if (process.env.NODE_ENV !== 'production') {
        // Conveniência de dev/teste: sem RESEND_API_KEY, loga o link (com
        // token) para permitir seguir o fluxo manualmente. Nunca em produção.
        this.logger.log(
          `RESEND_API_KEY não configurado — link de redefinição de senha para ${email}: ${link}`,
        );
      } else {
        // Em produção, uma key ausente é uma falha de configuração — nunca
        // logar o token em claro. Apenas avisa e segue (forgot-password
        // nunca deve falhar por causa do envio de e-mail).
        this.logger.warn(
          `RESEND_API_KEY não configurado em produção — e-mail de redefinição de senha para ${email} não pôde ser enviado`,
        );
      }
      return;
    }

    try {
      await this.client.emails.send({
        from: this.from,
        to: email,
        subject,
        html,
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
