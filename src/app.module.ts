import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PasswordModule } from './auth/password/password.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SheltersModule } from './shelters/shelters.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    PasswordModule,
    AuthModule,
    SheltersModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
