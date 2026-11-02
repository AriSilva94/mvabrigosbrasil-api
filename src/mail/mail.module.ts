import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { MailService, MAIL_TRANSPORT } from './mail.service';
import type { MailTransport } from './mail.service';
import type { Env } from '../config/env.validation';

const SMTP_TIMEOUT_MS = 10_000;

@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      useFactory: (config: ConfigService<Env, true>): MailTransport | null => {
        const host = config.get('SMTP_HOST', { infer: true });
        // Sem SMTP_HOST (dev/local), o transporte fica null e MailService
        // loga o link em vez de enviar (nunca lança).
        if (!host) return null;

        const user = config.get('SMTP_USER', { infer: true });
        const pass = config.get('SMTP_PASS', { infer: true });

        // Os timeouts evitam que um SMTP fora do ar segure o forgot-password.
        return createTransport({
          host,
          // Padrão da Hostinger: smtp.hostinger.com, 465 com SSL.
          port: config.get('SMTP_PORT', { infer: true }) ?? 465,
          secure: config.get('SMTP_SECURE', { infer: true }) ?? true,
          auth: user && pass ? { user, pass } : undefined,
          connectionTimeout: SMTP_TIMEOUT_MS,
          greetingTimeout: SMTP_TIMEOUT_MS,
          socketTimeout: SMTP_TIMEOUT_MS,
        });
      },
      inject: [ConfigService],
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
