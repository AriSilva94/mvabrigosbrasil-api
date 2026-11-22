import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { RedisService } from '../redis/redis.service';
import type { EmailAttachment } from './email-assets';
import { passwordResetEmail } from './password-reset.template';
import type { EmailContent } from './password-reset.template';
import { emailVerificationEmail } from './email-verification.template';
import { passwordChangedEmail } from './password-changed.template';

export const RESEND_CLIENT = 'RESEND_CLIENT';

export interface ResendLike {
  emails: {
    send(payload: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text: string;
      attachments?: {
        filename: string;
        content: Buffer;
        contentId: string;
        contentType: string;
      }[];
    }): Promise<{ data: unknown; error: { message: string } | null }>;
  };
}

// Mesmo prazo do TTL do token em AuthService (`PWD_RESET_TTL_SECONDS`).
const PASSWORD_RESET_VALIDITY_MINUTES = 60;
const EMAIL_VERIFICATION_VALIDITY_HOURS = 24;

const DEFAULT_DAILY_LIMIT = 100;
const STANDARD_SHARE = 0.7;
const QUOTA_KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

type MailPriority = 'critical' | 'standard';

const DEFAULT_FROM = 'MV Abrigos <no-reply@mail.mvabrigosbrasil.com.br>';
const DEFAULT_SITE_URL = 'https://mvabrigosbrasil.com.br';

function toResendAttachment(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    content: attachment.content,
    contentId: attachment.cid,
    contentType: attachment.contentType,
  };
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  private readonly siteUrl: string;
  private readonly dailyLimit: number;

  constructor(
    @Inject(RESEND_CLIENT) private readonly client: ResendLike | null,
    config: ConfigService<Env, true>,
    @Optional() private readonly redisService?: RedisService,
  ) {
    this.dailyLimit =
      config.get('MAIL_DAILY_LIMIT', { infer: true }) ?? DEFAULT_DAILY_LIMIT;
    this.from = config.get('MAIL_FROM', { infer: true }) ?? DEFAULT_FROM;
    const appUrl = config.get('APP_URL', { infer: true });
    this.siteUrl = appUrl ? new URL(appUrl).origin : DEFAULT_SITE_URL;
  }

  async sendPasswordReset(email: string, link: string): Promise<void> {
    const content = passwordResetEmail(
      link,
      PASSWORD_RESET_VALIDITY_MINUTES,
      this.siteUrl,
    );

    if (!this.client) {
      this.logWithoutClient('redefinição de senha', email, link);
      return;
    }

    await this.deliver(email, content, 'redefinição de senha', 'critical');
  }

  async sendEmailVerification(email: string, link: string): Promise<void> {
    const content = emailVerificationEmail(
      link,
      EMAIL_VERIFICATION_VALIDITY_HOURS,
      this.siteUrl,
    );

    if (!this.client) {
      this.logWithoutClient('confirmação de e-mail', email, link);
      return;
    }

    await this.deliver(email, content, 'confirmação de e-mail', 'standard');
  }

  async sendPasswordChanged(email: string): Promise<void> {
    if (!this.client) return;

    const content = passwordChangedEmail(
      new URL('/recuperar-senha', this.siteUrl).toString(),
      this.siteUrl,
    );
    await this.deliver(email, content, 'senha alterada', 'standard');
  }

  private async reserveQuota(priority: MailPriority): Promise<boolean> {
    if (!this.redisService) return true;

    const cap =
      priority === 'critical'
        ? this.dailyLimit
        : Math.floor(this.dailyLimit * STANDARD_SHARE);
    const key = `mail_quota:${new Date().toISOString().slice(0, 10)}`;
    try {
      const { client } = this.redisService;
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, QUOTA_KEY_TTL_SECONDS);
      if (count > cap) {
        await client.decr(key);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(
        'Falha ao consultar o teto diário de e-mails',
        err instanceof Error ? err.stack : String(err),
      );
      return true;
    }
  }

  private logWithoutClient(kind: string, email: string, link: string): void {
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(
        `RESEND_API_KEY não configurada — link de ${kind} para ${email}: ${link}`,
      );
      return;
    }
    this.logger.warn(
      `RESEND_API_KEY não configurada em produção — e-mail de ${kind} para ${email} não pôde ser enviado`,
    );
  }

  private async deliver(
    to: string,
    content: EmailContent,
    kind: string,
    priority: MailPriority,
  ): Promise<void> {
    if (!(await this.reserveQuota(priority))) {
      this.logger.warn(
        `Teto diário de e-mails atingido — e-mail de ${kind} não enviado`,
      );
      return;
    }

    try {
      const { error } = await (this.client as ResendLike).emails.send({
        from: this.from,
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
        attachments: content.attachments.map(toResendAttachment),
      });
      if (error) {
        this.logger.error(
          `Falha ao enviar e-mail de ${kind} para ${to}: ${error.message}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Falha ao enviar e-mail de ${kind} para ${to}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
