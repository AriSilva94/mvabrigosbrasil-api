import { Module } from '@nestjs/common';
import { ApplicationsModule } from './applications/applications.module';
import { AuthModule } from './auth/auth.module';
import { PasswordModule } from './auth/password/password.module';
import { ConfigModule } from './config/config.module';
import { DynamicsModule } from './dynamics/dynamics.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { SheltersModule } from './shelters/shelters.module';
import { VacanciesModule } from './vacancies/vacancies.module';
import { VolunteersModule } from './volunteers/volunteers.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    HealthModule,
    PasswordModule,
    AuthModule,
    SheltersModule,
    DynamicsModule,
    VacanciesModule,
    ApplicationsModule,
    VolunteersModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
