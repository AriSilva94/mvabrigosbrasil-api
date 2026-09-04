import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.validation';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  client!: Redis;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  // Kept async so the return type stays Promise<void> for OnModuleInit
  // callers/tests; the connection itself is deliberately not awaited below.
  // eslint-disable-next-line @typescript-eslint/require-await
  async onModuleInit(): Promise<void> {
    this.client = new Redis(this.config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
    this.client.on('error', (err: Error) => {
      this.logger.error(`Redis connection error: ${err.message}`, err.stack);
    });
    // Fire-and-forget: ioredis keeps retrying on its own (default retryStrategy)
    // once lazyConnect kicks off the first connection attempt, so a Redis outage
    // at boot must not block or fail application bootstrap. The `error` listener
    // above ensures failures are still logged instead of surfacing as an
    // unhandled ioredis event.
    this.client.connect().catch((err: Error) => {
      this.logger.error(
        `Redis initial connection failed: ${err.message}`,
        err.stack,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  ping(): Promise<'PONG'> {
    return this.client.ping();
  }
}
