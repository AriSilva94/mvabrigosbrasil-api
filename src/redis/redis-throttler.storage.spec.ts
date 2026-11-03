import { RedisService } from './redis.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  let redis: RedisService;
  let storage: RedisThrottlerStorage;

  beforeAll(async () => {
    redis = new RedisService({
      get: () => process.env.REDIS_TEST_URL ?? 'redis://localhost:6380/15',
    } as never);
    await redis.onModuleInit();
    storage = new RedisThrottlerStorage(redis);
  });

  afterEach(async () => {
    const keys = await redis.client.keys('throttle:*');
    if (keys.length > 0) await redis.client.del(...keys);
  });

  afterAll(async () => {
    await redis.onModuleDestroy();
  });

  it('counts hits inside the window without blocking up to the limit', async () => {
    const first = await storage.increment('k', 60_000, 2, 60_000, 'default');
    const second = await storage.increment('k', 60_000, 2, 60_000, 'default');

    expect(first).toMatchObject({ totalHits: 1, isBlocked: false });
    expect(second).toMatchObject({ totalHits: 2, isBlocked: false });
    expect(second.timeToExpire).toBeGreaterThan(55);
  });

  it('blocks once the limit is exceeded and keeps blocking while the block lasts', async () => {
    for (let i = 0; i < 2; i++) {
      await storage.increment('k', 60_000, 2, 30_000, 'default');
    }

    const over = await storage.increment('k', 60_000, 2, 30_000, 'default');
    const again = await storage.increment('k', 60_000, 2, 30_000, 'default');

    expect(over).toMatchObject({ totalHits: 3, isBlocked: true });
    expect(over.timeToBlockExpire).toBe(30);
    expect(again).toMatchObject({ totalHits: 3, isBlocked: true });
  });

  it('shares the counter between storage instances (several API replicas)', async () => {
    const other = new RedisThrottlerStorage(redis);

    await storage.increment('k', 60_000, 1, 60_000, 'default');
    const fromOther = await other.increment('k', 60_000, 1, 60_000, 'default');

    expect(fromOther).toMatchObject({ totalHits: 2, isBlocked: true });
  });

  it('starts a new window after the ttl expires', async () => {
    await storage.increment('k', 50, 1, 50, 'default');
    await storage.increment('k', 50, 1, 50, 'default');
    await new Promise((resolve) => setTimeout(resolve, 80));

    await expect(
      storage.increment('k', 50, 1, 50, 'default'),
    ).resolves.toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('keeps the API up (not blocked) when Redis fails', async () => {
    const broken = new RedisThrottlerStorage({
      client: { eval: jest.fn().mockRejectedValue(new Error('down')) },
    } as never);

    await expect(
      broken.increment('k', 60_000, 1, 60_000, 'default'),
    ).resolves.toMatchObject({ isBlocked: false });
  });
});
