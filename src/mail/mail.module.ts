import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { MailService, RESEND_CLIENT } from './mail.service';
import type { ResendLikeClient } from './mail.service';
import type { Env } from '../config/env.validation';

@Module({
  providers: [
    {
      provide: RESEND_CLIENT,
      useFactory: (
        config: ConfigService<Env, true>,
      ): ResendLikeClient | null => {
        const apiKey = config.get('RESEND_API_KEY', { infer: true });
        // Sem RESEND_API_KEY (dev/local), o cliente fica null e
        // MailService loga o link em vez de enviar (nunca lança).
        return apiKey ? new Resend(apiKey) : null;
      },
      inject: [ConfigService],
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
