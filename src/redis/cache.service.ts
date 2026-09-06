import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

const CACHE_NAMESPACE = 'cache:v1:';
const SCAN_BATCH_SIZE = 100;

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(private readonly redis: RedisService) {}

  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    producer: () => Promise<T>,
  ): Promise<T> {
    const namespacedKey = `${CACHE_NAMESPACE}${key}`;

    try {
      const cached = await this.redis.client.get(namespacedKey);
      if (cached !== null) {
        try {
          return JSON.parse(cached) as T;
        } catch (error) {
          this.logFailure(`Invalid cached JSON for ${namespacedKey}`, error);
        }
      }
    } catch (error) {
      this.logFailure(`Cache read failed for ${namespacedKey}`, error);
    }

    const value = await producer();

    try {
      await this.redis.client.set(
        namespacedKey,
        JSON.stringify(value),
        'EX',
        ttlSeconds,
      );
    } catch (error) {
      this.logFailure(`Cache write failed for ${namespacedKey}`, error);
    }

    return value;
  }

  async del(prefix: string): Promise<void> {
    const pattern = `${CACHE_NAMESPACE}${prefix}`;
    let cursor = '0';

    try {
      do {
        const [nextCursor, keys] = await this.redis.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          SCAN_BATCH_SIZE,
        );
        cursor = nextCursor;

        if (keys.length > 0) {
          await this.redis.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error) {
      this.logFailure(`Cache invalidation failed for ${pattern}`, error);
    }
  }

  private logFailure(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}: ${detail}`);
  }
}
