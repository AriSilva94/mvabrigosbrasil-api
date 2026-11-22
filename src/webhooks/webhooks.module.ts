import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { ResendWebhookController } from './resend-webhook.controller';

@Module({
  imports: [MailModule],
  controllers: [ResendWebhookController],
})
export class WebhooksModule {}
