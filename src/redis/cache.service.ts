import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

const CACHE_NAMESPACE = 'cache:v1:';
const SCAN_BATCH_SIZE = 100;
const SET_IF_GENERATION_MATCHES = `
  local current = redis.call('GET', KEYS[1]) or '0'
  if current ~= ARGV[1] then
    return 0
  end
  redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
  return 1
`;

function generationKey(value: string): string {
  const scope = value.split(':', 1)[0]?.replace('*', '') || 'global';
  return `${CACHE_NAMESPACE}generation:${scope}`;
}

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
    let cacheAvailable = true;

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
      cacheAvailable = false;
      this.logFailure(`Cache read failed for ${namespacedKey}`, error);
    }

    let generation: string | null = null;
    if (cacheAvailable) {
      try {
        generation = (await this.redis.client.get(generationKey(key))) ?? '0';
      } catch (error) {
        this.logFailure(
          `Cache generation read failed for ${namespacedKey}`,
          error,
        );
      }
    }

    const value = await producer();

    if (generation !== null) {
      try {
        await this.redis.client.eval(
          SET_IF_GENERATION_MATCHES,
          2,
          generationKey(key),
          namespacedKey,
          generation,
          JSON.stringify(value),
          String(ttlSeconds),
        );
      } catch (error) {
        this.logFailure(`Cache write failed for ${namespacedKey}`, error);
      }
    }

    return value;
  }

  async del(prefix: string): Promise<void> {
    const pattern = `${CACHE_NAMESPACE}${prefix}`;
    let cursor = '0';

    try {
      await this.redis.client.incr(generationKey(prefix));
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
