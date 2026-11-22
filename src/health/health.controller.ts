import { Controller, Get, Header, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public';
import type { Env } from '../config/env.validation';
import {
  INTERNAL_TOKEN_HEADER,
  sameSecret,
} from '../common/utils/internal-request';
import { HealthDetails, HealthService, HealthStatus } from './health.service';

// Task 11: guards de auth (`JwtAuthGuard`/`RolesGuard`) e `ThrottlerGuard`
// agora são globais (`APP_GUARD`, ver `AuthModule`) — `@Public()` mantém
// `/api/v1/health` acessível sem sessão, como exigido por health checks de
// infraestrutura (load balancer, orquestrador etc).
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async check(@Req() req: Request): Promise<HealthStatus | HealthDetails> {
    const result = await this.health.check();
    return this.canSeeDetails(req) ? result : { status: result.status };
  }

  // revision/db/redis ajudam a mapear a infraestrutura; só o deploy (CI), que
  // conhece o INTERNAL_API_TOKEN, precisa deles.
  private canSeeDetails(req: Request): boolean {
    const token = this.config.get('INTERNAL_API_TOKEN', { infer: true });
    const provided = req.headers[INTERNAL_TOKEN_HEADER];
    return (
      !!token && typeof provided === 'string' && sameSecret(provided, token)
    );
  }
}
