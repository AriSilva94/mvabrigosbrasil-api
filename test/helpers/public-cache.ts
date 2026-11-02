import type { RedisService } from '../../src/redis/redis.service';

const PUBLIC_CACHE_KEYS = [
  'cache:v1:public:map-statistics',
  'cache:v1:public:database-dataset',
  'cache:v1:generation:public',
] as const;

export type PublicCacheSnapshot = {
  capturedAt: number;
  entries: Array<{ key: string; value: string | null; pttl: number }>;
};

export async function snapshotPublicCache(
  redis: RedisService,
): Promise<PublicCacheSnapshot> {
  return {
    capturedAt: Date.now(),
    entries: await Promise.all(
      PUBLIC_CACHE_KEYS.map(async (key) => ({
        key,
        value: await redis.client.get(key),
        pttl: await redis.client.pttl(key),
      })),
    ),
  };
}

export async function restorePublicCache(
  redis: RedisService,
  snapshot: PublicCacheSnapshot,
): Promise<void> {
  await redis.client.del(...PUBLIC_CACHE_KEYS);
  const elapsed = Date.now() - snapshot.capturedAt;

  for (const entry of snapshot.entries) {
    if (entry.value === null) continue;
    if (entry.pttl === -1) {
      await redis.client.set(entry.key, entry.value);
      continue;
    }

    const remaining = entry.pttl - elapsed;
    if (remaining > 0) {
      await redis.client.set(entry.key, entry.value, 'PX', remaining);
    }
  }
}
