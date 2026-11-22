import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public';
import { RESEND_CLIENT } from '../mail/mail.service';
import type { Env } from '../config/env.validation';

interface ResendWebhooksClient {
  webhooks: {
    verify(options: {
      payload: string;
      headers: { id: string; timestamp: string; signature: string };
      webhookSecret: string;
    }): { type: string; data: object };
  };
}

const ATTENTION_EVENTS = new Set([
  'email.bounced',
  'email.complained',
  'email.delivery_delayed',
  'email.failed',
]);

@Public()
@SkipThrottle()
@Controller('webhooks/resend')
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    @Inject(RESEND_CLIENT) private readonly client: unknown,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post()
  @HttpCode(200)
  handle(@Req() req: RawBodyRequest<Request>): { ok: true } {
    const secret = this.config.get('RESEND_WEBHOOK_SECRET', { infer: true });
    const resend = this.client as ResendWebhooksClient | null;
    if (!secret || !resend) {
      throw new NotFoundException();
    }

    const payload = req.rawBody?.toString('utf8');
    if (!payload) {
      throw new BadRequestException({ error: 'Corpo ausente.' });
    }

    let event: { type: string; data: object };
    try {
      event = resend.webhooks.verify({
        payload,
        headers: {
          id: String(req.headers['webhook-id'] ?? ''),
          timestamp: String(req.headers['webhook-timestamp'] ?? ''),
          signature: String(req.headers['webhook-signature'] ?? ''),
        },
        webhookSecret: secret,
      });
    } catch {
      throw new BadRequestException({ error: 'Assinatura inválida.' });
    }

    if (ATTENTION_EVENTS.has(event.type)) {
      const emailId =
        'email_id' in event.data ? String(event.data.email_id) : 'desconhecido';
      this.logger.warn(`Resend ${event.type} (email_id=${emailId})`);
    }

    return { ok: true };
  }
}
