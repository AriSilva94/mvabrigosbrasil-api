import { Module } from '@nestjs/common';
import { PasswordModule } from './auth/password/password.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    PasswordModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
