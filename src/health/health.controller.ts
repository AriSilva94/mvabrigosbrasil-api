import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public';
import { HealthService, HealthStatus } from './health.service';

// Task 11: guards de auth (`JwtAuthGuard`/`RolesGuard`) e `ThrottlerGuard`
// agora são globais (`APP_GUARD`, ver `AuthModule`) — `@Public()` mantém
// `/api/v1/health` acessível sem sessão, como exigido por health checks de
// infraestrutura (load balancer, orquestrador etc).
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Public()
  @Get()
  check(): Promise<HealthStatus> {
    return this.health.check();
  }
}
