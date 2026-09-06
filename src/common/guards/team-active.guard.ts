import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Claims } from '../../auth/jwt/token.service';
import { TEAM_ACTIVE_KEY } from '../decorators/team-active';

/**
 * Enforces `@RequireTeamActive()` on a route/handler. Assumes `JwtAuthGuard`
 * ran first and populated `req.user`.
 *
 * - No `@RequireTeamActive` metadata -> allow.
 * - Metadata present and `req.user.teamDisabled` true -> 403.
 */
@Injectable()
export class TeamActiveGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresTeamActive = this.reflector.getAllAndOverride<boolean>(
      TEAM_ACTIVE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiresTeamActive) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: Claims }>();

    if (req.user?.teamDisabled) {
      throw new ForbiddenException('Acesso negado');
    }

    return true;
  }
}
