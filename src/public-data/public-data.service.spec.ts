import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { CacheService } from '../redis/cache.service';
import { PublicDataService } from './public-data.service';

const loggerErrorSpy = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

afterAll(() => loggerErrorSpy.mockRestore());

function createPrismaMock() {
  return {
    shelter: { findMany: jest.fn() },
    shelterDynamics: { findMany: jest.fn() },
  };
}

function createCacheMock() {
  return {
    getOrSet: jest.fn(
      (_key: string, _ttl: number, producer: () => Promise<unknown>) =>
        producer(),
    ),
  };
}

describe('PublicDataService map statistics', () => {
  it('filters active shelters and preserves the frontend reducers', async () => {
    const prisma = createPrismaMock();
    const cache = createCacheMock();
    prisma.shelter.findMany.mockResolvedValue([
      { state: 'rs', shelterType: 'public' },
      { state: 'RS', shelterType: 'private' },
      { state: null, shelterType: 'unknown' },
      { state: 'sp', shelterType: 'temporary' },
      { state: 'rj', shelterType: 'mixed' },
    ]);
    const service = new PublicDataService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheService,
    );

    await expect(service.getMapStatistics()).resolves.toEqual({
      byState: [
        { state: 'RS', count: 2 },
        { state: 'SP', count: 1 },
        { state: 'RJ', count: 1 },
      ],
      byType: { total: 5, public: 1, private: 1, mixed: 1, temporary: 1 },
    });
    expect(prisma.shelter.findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { state: true, shelterType: true },
    });
    expect(cache.getOrSet).toHaveBeenCalledWith(
      'public:map-statistics',
      900,
      expect.any(Function),
    );
  });

  it('returns the documented statistics error without leaking Prisma details', async () => {
    const prisma = createPrismaMock();
    const cache = createCacheMock();
    prisma.shelter.findMany.mockRejectedValue(new Error('database secret'));
    const service = new PublicDataService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheService,
    );

    await expect(service.getMapStatistics()).rejects.toEqual(
      new InternalServerErrorException({
        error: 'Failed to fetch shelter statistics',
      }),
    );
  });
});

describe('PublicDataService database dataset', () => {
  it('queries complete Prisma selects and maps all rows through the cache', async () => {
    const prisma = createPrismaMock();
    const cache = createCacheMock();
    prisma.shelter.findMany.mockResolvedValue([
      {
        id: 'shelter-a',
        wpPostId: 9,
        name: 'Abrigo',
        state: 'mg',
        shelterType: 'public',
        foundationDate: null,
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
      },
    ]);
    prisma.shelterDynamics.findMany.mockResolvedValue([]);
    const service = new PublicDataService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheService,
    );

    const result = await service.getDatabaseDataset();

    expect(result.shelters).toHaveLength(1);
    expect(result.movements).toHaveLength(0);
    expect(prisma.shelter.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        wpPostId: true,
        name: true,
        state: true,
        shelterType: true,
        foundationDate: true,
        createdAt: true,
      },
    });
    expect(prisma.shelterDynamics.findMany).toHaveBeenCalledWith({
      select: expect.objectContaining({
        id: true,
        shelterId: true,
        dynamicType: true,
        referenceDate: true,
        retornoLocalGatos: true,
      }) as unknown,
    });
    expect(cache.getOrSet).toHaveBeenCalledWith(
      'public:database-dataset',
      900,
      expect.any(Function),
    );
  });

  it('returns the documented generic dataset error', async () => {
    const prisma = createPrismaMock();
    const cache = createCacheMock();
    prisma.shelter.findMany.mockRejectedValue(new Error('database secret'));
    prisma.shelterDynamics.findMany.mockResolvedValue([]);
    const service = new PublicDataService(
      prisma as unknown as PrismaService,
      cache as unknown as CacheService,
    );

    await expect(service.getDatabaseDataset()).rejects.toEqual(
      new InternalServerErrorException({ error: 'Internal server error' }),
    );
  });
});
