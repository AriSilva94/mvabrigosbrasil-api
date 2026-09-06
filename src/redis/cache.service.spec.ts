import { Logger } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import type { RedisService } from './redis.service';
import { CacheService } from './cache.service';
import { RedisModule } from './redis.module';

const loggerErrorSpy = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

afterAll(() => loggerErrorSpy.mockRestore());

function createRedisMock() {
  return {
    client: {
      get: jest.fn(),
      set: jest.fn(),
      scan: jest.fn(),
      del: jest.fn(),
    },
  };
}

describe('CacheService', () => {
  it('returns a JSON cache hit without calling the producer', async () => {
    const redis = createRedisMock();
    redis.client.get.mockResolvedValue(JSON.stringify({ value: 1 }));
    const producer = jest.fn();
    const service = new CacheService(redis as unknown as RedisService);

    await expect(
      service.getOrSet('public:test', 900, producer),
    ).resolves.toEqual({ value: 1 });
    expect(redis.client.get).toHaveBeenCalledWith('cache:v1:public:test');
    expect(producer).not.toHaveBeenCalled();
  });

  it('produces and stores a cache miss with SET EX', async () => {
    const redis = createRedisMock();
    redis.client.get.mockResolvedValue(null);
    redis.client.set.mockResolvedValue('OK');
    const producer = jest.fn().mockResolvedValue({ value: 2 });
    const service = new CacheService(redis as unknown as RedisService);

    await expect(
      service.getOrSet('public:test', 900, producer),
    ).resolves.toEqual({ value: 2 });
    expect(producer).toHaveBeenCalledTimes(1);
    expect(redis.client.set).toHaveBeenCalledWith(
      'cache:v1:public:test',
      JSON.stringify({ value: 2 }),
      'EX',
      900,
    );
  });

  it('fails open when Redis GET or SET fails', async () => {
    const redis = createRedisMock();
    redis.client.get.mockRejectedValue(new Error('redis unavailable'));
    redis.client.set.mockRejectedValue(new Error('redis unavailable'));
    const producer = jest.fn().mockResolvedValue({ live: true });
    const service = new CacheService(redis as unknown as RedisService);

    await expect(
      service.getOrSet('public:test', 900, producer),
    ).resolves.toEqual({ live: true });
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it('treats malformed cached JSON as a miss', async () => {
    const redis = createRedisMock();
    redis.client.get.mockResolvedValue('{invalid');
    redis.client.set.mockResolvedValue('OK');
    const producer = jest.fn().mockResolvedValue(['fresh']);
    const service = new CacheService(redis as unknown as RedisService);

    await expect(
      service.getOrSet('public:test', 30, producer),
    ).resolves.toEqual(['fresh']);
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it('scans and deletes every namespaced key matching a prefix in batches', async () => {
    const redis = createRedisMock();
    redis.client.scan
      .mockResolvedValueOnce(['7', ['cache:v1:public:a', 'cache:v1:public:b']])
      .mockResolvedValueOnce(['0', ['cache:v1:public:c']]);
    redis.client.del.mockResolvedValue(1);
    const service = new CacheService(redis as unknown as RedisService);

    await service.del('public:*');

    expect(redis.client.scan).toHaveBeenNthCalledWith(
      1,
      '0',
      'MATCH',
      'cache:v1:public:*',
      'COUNT',
      100,
    );
    expect(redis.client.scan).toHaveBeenNthCalledWith(
      2,
      '7',
      'MATCH',
      'cache:v1:public:*',
      'COUNT',
      100,
    );
    expect(redis.client.del).toHaveBeenNthCalledWith(
      1,
      'cache:v1:public:a',
      'cache:v1:public:b',
    );
    expect(redis.client.del).toHaveBeenNthCalledWith(2, 'cache:v1:public:c');
  });

  it('fails open when prefix invalidation cannot reach Redis', async () => {
    const redis = createRedisMock();
    redis.client.scan.mockRejectedValue(new Error('redis unavailable'));
    const service = new CacheService(redis as unknown as RedisService);

    await expect(service.del('public:*')).resolves.toBeUndefined();
  });
});

describe('RedisModule cache exports', () => {
  it('provides and exports CacheService', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      RedisModule,
    ) as unknown[];
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      RedisModule,
    ) as unknown[];

    expect(providers).toContain(CacheService);
    expect(exports).toContain(CacheService);
  });
});
