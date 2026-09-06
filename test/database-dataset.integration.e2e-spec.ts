import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '../src/config/config.module';
import { PrismaService } from '../src/prisma/prisma.service';
import type { CacheService } from '../src/redis/cache.service';
import { PublicDataService } from '../src/public-data/public-data.service';

describe('database dataset (integration, read-only)', () => {
  let prisma: PrismaService;
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [PrismaService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('matches direct shelter and dynamics counts without mutating data', async () => {
    const cache = {
      getOrSet: (
        _key: string,
        _ttl: number,
        producer: () => Promise<unknown>,
      ) => producer(),
    } as CacheService;
    const service = new PublicDataService(prisma, cache);

    const [dataset, shelterCount, dynamicsCount] = await Promise.all([
      service.getDatabaseDataset(),
      prisma.shelter.count(),
      prisma.shelterDynamics.count(),
    ]);

    expect(dataset.shelters).toHaveLength(shelterCount);
    expect(dataset.movements).toHaveLength(dynamicsCount);
  });
});
