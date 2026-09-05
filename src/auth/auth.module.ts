import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LegacyMigrationService } from './legacy-migration.service';
import { JwtAuthModule } from './jwt/jwt.module';
import { PasswordModule } from './password/password.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

// Task 11: módulo agora "completo" — `JwtAuthGuard` e `RolesGuard` (Task 4)
// são registrados como `APP_GUARD` globais, então TODA rota da API exige
// uma sessão válida a menos que marcada `@Public()`. `ThrottlerGuard`
// (`@nestjs/throttler`) também é global, e roda ANTES dos guards de auth —
// assim uma rajada de tentativas é limitada mesmo antes de validar o
// token/credenciais.
//
// Storage do throttler: em memória (padrão do pacote), NÃO Redis. Um
// storage Redis dedicado para `@nestjs/throttler` v6 exigiria uma
// dependência de terceiros (`nestjs-throttler-storage-redis`) cujo
// `peerDependencies` só declara suporte a `@nestjs/core`/`common` até
// `^10.0.0` (este projeto está em Nest 11) e que não recebe atualização
// desde 08/2024 — arriscado e potencialmente incompatível. Ver ADR/relatório
// da Task 11 para o acompanhamento: com múltiplas instâncias da API atrás
// de um load balancer, o rate limit atual é por instância, não global.
//
// `RedisModule` é `@Global()`, então `SessionService`/`RedisService`
// continuam disponíveis sem import explícito aqui. `MailModule` (Task 10)
// expõe `MailService`, usado por `forgotPassword`.
@Module({
  imports: [
    UsersModule,
    PasswordModule,
    JwtAuthModule,
    PrismaModule,
    MailModule,
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 100,
      },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LegacyMigrationService,
    // Ordem importa: throttling primeiro (rejeita rajadas antes de gastar
    // trabalho de auth), depois autenticação, depois autorização por role.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
