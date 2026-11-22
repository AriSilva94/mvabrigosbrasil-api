import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LegacyMigrationService } from './legacy-migration.service';
import { EmailVerificationService } from './email-verification.service';
import { JwtAuthModule } from './jwt/jwt.module';
import { PasswordModule } from './password/password.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { getClientIp } from '../common/utils/client-ip';
import { isInternalRequest } from '../common/utils/internal-request';
import { RedisService } from '../redis/redis.service';
import { RedisThrottlerStorage } from '../redis/redis-throttler.storage';
import type { Env } from '../config/env.validation';
import type { Request } from 'express';

@Module({
  imports: [
    UsersModule,
    PasswordModule,
    JwtAuthModule,
    PrismaModule,
    MailModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService<Env, true>, redis: RedisService) => {
        const internalToken = config.get('INTERNAL_API_TOKEN', { infer: true });
        if (
          !internalToken &&
          config.get('NODE_ENV', { infer: true }) === 'production'
        ) {
          new Logger(AuthModule.name).warn(
            'INTERNAL_API_TOKEN ausente: qualquer chamada da rede privada sem cabeçalho de proxy fica fora do rate limit',
          );
        }
        return {
          throttlers: [
            {
              name: 'default',
              ttl: 60_000,
              limit: 100,
            },
          ],
          storage: new RedisThrottlerStorage(redis),
          getTracker: (req: Request) => getClientIp(req),
          skipIf: (context) =>
            isInternalRequest(
              context.switchToHttp().getRequest<Request>(),
              internalToken,
            ),
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LegacyMigrationService,
    EmailVerificationService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
