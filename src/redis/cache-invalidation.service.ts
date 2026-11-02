import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from './cache.service';

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(private readonly cache: CacheService) {}

  async invalidatePublicData(): Promise<void> {
    try {
      await this.cache.del('public:*');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Public cache invalidation failed: ${detail}`);
    }
  }
}
