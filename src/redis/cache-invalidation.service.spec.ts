import { Logger } from '@nestjs/common';
import type { CacheService } from './cache.service';
import { CacheInvalidationService } from './cache-invalidation.service';

const loggerErrorSpy = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

afterAll(() => loggerErrorSpy.mockRestore());

describe('CacheInvalidationService', () => {
  it('invalidates every public data key by prefix', async () => {
    const cache = { del: jest.fn().mockResolvedValue(undefined) };
    const service = new CacheInvalidationService(
      cache as unknown as CacheService,
    );

    await service.invalidatePublicData();

    expect(cache.del).toHaveBeenCalledWith('public:*');
  });

  it('fails open so a successful domain write is not changed into a 500', async () => {
    const cache = { del: jest.fn().mockRejectedValue(new Error('redis down')) };
    const service = new CacheInvalidationService(
      cache as unknown as CacheService,
    );

    await expect(service.invalidatePublicData()).resolves.toBeUndefined();
  });
});
