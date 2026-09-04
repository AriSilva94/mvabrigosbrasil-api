import { RedisService } from './redis.service';

describe('RedisService', () => {
  it('connects, sets and gets', async () => {
    const service = new RedisService({
      get: () => process.env.REDIS_TEST_URL ?? 'redis://localhost:6380/15',
    } as never);
    await service.onModuleInit();
    await service.client.set('spec:key', 'v', 'EX', 5);
    expect(await service.client.get('spec:key')).toBe('v');
    expect(await service.ping()).toBe('PONG');
    await service.onModuleDestroy();
  });
});
