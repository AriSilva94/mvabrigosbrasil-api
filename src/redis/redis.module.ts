import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { SessionService } from './session.service';

@Global()
@Module({
  providers: [RedisService, SessionService],
  exports: [RedisService, SessionService],
})
export class RedisModule {}
