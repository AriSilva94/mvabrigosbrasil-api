import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { buildDatabaseDataset } from './dataset';

const PUBLIC_CACHE_TTL_SECONDS = 900;

export type MapStatistics = {
  byState: Array<{ state: string; count: number }>;
  byType: {
    total: number;
    public: number;
    private: number;
    mixed: number;
    temporary: number;
  };
};

@Injectable()
export class PublicDataService {
  private readonly logger = new Logger(PublicDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getMapStatistics(): Promise<MapStatistics> {
    return this.cache.getOrSet(
      'public:map-statistics',
      PUBLIC_CACHE_TTL_SECONDS,
      async () => {
        try {
          const shelters = await this.prisma.shelter.findMany({
            where: { active: true },
            select: { state: true, shelterType: true },
          });

          const byState = shelters.reduce<
            Array<{ state: string; count: number }>
          >((acc, shelter) => {
            const state = shelter.state?.toUpperCase();
            if (!state) return acc;
            const existing = acc.find((item) => item.state === state);
            if (existing) existing.count++;
            else acc.push({ state, count: 1 });
            return acc;
          }, []);

          const byType = shelters.reduce<MapStatistics['byType']>(
            (acc, shelter) => {
              acc.total++;
              const type = shelter.shelterType as keyof Omit<
                MapStatistics['byType'],
                'total'
              >;
              if (type && type in acc) acc[type]++;
              return acc;
            },
            { total: 0, public: 0, private: 0, mixed: 0, temporary: 0 },
          );

          return { byState, byType };
        } catch (error) {
          this.logError('Error fetching shelters', error);
          throw new InternalServerErrorException({
            error: 'Failed to fetch shelter statistics',
          });
        }
      },
    );
  }

  async getDatabaseDataset() {
    return this.cache.getOrSet(
      'public:database-dataset',
      PUBLIC_CACHE_TTL_SECONDS,
      async () => {
        try {
          const [shelters, dynamics] = await Promise.all([
            this.prisma.shelter.findMany({
              select: {
                id: true,
                wpPostId: true,
                name: true,
                state: true,
                shelterType: true,
                foundationDate: true,
                createdAt: true,
              },
            }),
            this.prisma.shelterDynamics.findMany({
              select: {
                id: true,
                shelterId: true,
                kind: true,
                dynamicType: true,
                referenceDate: true,
                referencePeriod: true,
                entradasDeAnimais: true,
                entradasDeGatos: true,
                adocoesCaes: true,
                adocoesGatos: true,
                devolucoesCaes: true,
                devolucoesGatos: true,
                eutanasiasCaes: true,
                eutanasiasGatos: true,
                mortesNaturaisCaes: true,
                mortesNaturaisGatos: true,
                retornoDeCaes: true,
                retornoDeGatos: true,
                retornoLocalCaes: true,
                retornoLocalGatos: true,
              },
            }),
          ]);

          return buildDatabaseDataset(shelters, dynamics);
        } catch (error) {
          this.logError('Unexpected error in database-dataset', error);
          throw new InternalServerErrorException({
            error: 'Internal server error',
          });
        }
      },
    );
  }

  private logError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.logger.error(`${message}: ${detail}`);
  }
}
