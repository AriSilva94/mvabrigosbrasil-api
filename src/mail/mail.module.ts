import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { MailService, RESEND_CLIENT } from './mail.service';
import type { ResendLike } from './mail.service';
import type { Env } from '../config/env.validation';

@Module({
  providers: [
    {
      provide: RESEND_CLIENT,
      useFactory: (config: ConfigService<Env, true>): ResendLike | null => {
        const apiKey = config.get('RESEND_API_KEY', { infer: true });
        // Sem chave (dev/local), o cliente fica null e MailService loga o
        // link em vez de enviar (nunca lança).
        return apiKey ? new Resend(apiKey) : null;
      },
      inject: [ConfigService],
    },
    MailService,
  ],
  exports: [MailService, RESEND_CLIENT],
})
export class MailModule {}
