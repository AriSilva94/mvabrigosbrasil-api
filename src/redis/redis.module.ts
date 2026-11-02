import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { SessionService } from './session.service';
import { CacheService } from './cache.service';
import { CacheInvalidationService } from './cache-invalidation.service';

@Global()
@Module({
  providers: [
    RedisService,
    SessionService,
    CacheService,
    CacheInvalidationService,
  ],
  exports: [
    RedisService,
    SessionService,
    CacheService,
    CacheInvalidationService,
  ],
})
export class RedisModule {}
