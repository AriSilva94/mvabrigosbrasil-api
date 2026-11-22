import { createHmac } from 'crypto';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Resend } from 'resend';
import request from 'supertest';
import { RESEND_CLIENT } from '../mail/mail.service';
import { ResendWebhookController } from './resend-webhook.controller';

const SECRET_BYTES = Buffer.from('segredo-de-teste-do-webhook');
const SECRET = `whsec_${SECRET_BYTES.toString('base64')}`;

function signedHeaders(payload: string, secret = SECRET_BYTES) {
  const id = 'msg_test_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret)
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  return {
    'webhook-id': id,
    'webhook-timestamp': timestamp,
    'webhook-signature': `v1,${signature}`,
  };
}

function bouncedEvent(): string {
  return JSON.stringify({
    type: 'email.bounced',
    created_at: '2026-11-22T00:00:00.000Z',
    data: {
      email_id: 'email-abc',
      to: ['pessoa@example.com'],
      subject: 'x',
      bounce: { type: 'Permanent', message: 'no such user' },
    },
  });
}

async function createApp(options: {
  secret: string | undefined;
  client: unknown;
}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [ResendWebhookController],
    providers: [
      { provide: RESEND_CLIENT, useValue: options.client },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            key === 'RESEND_WEBHOOK_SECRET' ? options.secret : undefined,
        },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  return app;
}

describe('ResendWebhookController', () => {
  let app: INestApplication;
  let warnSpy: jest.SpyInstance<
    void,
    [message: unknown, ...optional: unknown[]]
  >;

  const http = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]);

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('404 when RESEND_WEBHOOK_SECRET is not configured', async () => {
    app = await createApp({ secret: undefined, client: new Resend('re_test') });
    const payload = bouncedEvent();

    await http()
      .post('/webhooks/resend')
      .set('content-type', 'application/json')
      .set(signedHeaders(payload))
      .send(payload)
      .expect(404);
  });

  it('400 when the signature does not match', async () => {
    app = await createApp({ secret: SECRET, client: new Resend('re_test') });
    const payload = bouncedEvent();

    await http()
      .post('/webhooks/resend')
      .set('content-type', 'application/json')
      .set(signedHeaders(payload, Buffer.from('outro-segredo')))
      .send(payload)
      .expect(400);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('200 and warns about a bounce with the email id but never the recipient address', async () => {
    app = await createApp({ secret: SECRET, client: new Resend('re_test') });
    const payload = bouncedEvent();

    await http()
      .post('/webhooks/resend')
      .set('content-type', 'application/json')
      .set(signedHeaders(payload))
      .send(payload)
      .expect(200, { ok: true });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0].join(' ');
    expect(logged).toContain('email.bounced');
    expect(logged).toContain('email-abc');
    expect(logged).not.toContain('pessoa@example.com');
  });

  it('200 without logging for events that need no attention', async () => {
    app = await createApp({ secret: SECRET, client: new Resend('re_test') });
    const payload = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-11-22T00:00:00.000Z',
      data: { email_id: 'email-abc', to: ['pessoa@example.com'] },
    });

    await http()
      .post('/webhooks/resend')
      .set('content-type', 'application/json')
      .set(signedHeaders(payload))
      .send(payload)
      .expect(200, { ok: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
