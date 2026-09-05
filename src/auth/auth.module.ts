import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LegacyMigrationService } from './legacy-migration.service';
import { JwtAuthModule } from './jwt/jwt.module';
import { PasswordModule } from './password/password.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

// Módulo parcial (Task 7): só o necessário para `POST /auth/login`.
// `JwtAuthGuard`/`RolesGuard` ainda não são registrados globalmente
// (`APP_GUARD`) — isso é Task 11, quando todas as rotas tiverem `@Public()`
// aplicado onde precisam. `RedisModule` é `@Global()` então `SessionService`
// e `RedisService` já estão disponíveis sem import explícito aqui.
// `MailModule` (Task 10) expõe `MailService`, usado por `forgotPassword`.
@Module({
  imports: [
    UsersModule,
    PasswordModule,
    JwtAuthModule,
    PrismaModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, LegacyMigrationService],
})
export class AuthModule {}
