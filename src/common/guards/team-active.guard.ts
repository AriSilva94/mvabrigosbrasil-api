import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Claims } from '../../auth/jwt/token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TEAM_ACTIVE_KEY } from '../decorators/team-active';

/**
 * Enforces `@RequireTeamActive()` on a route/handler. Assumes `JwtAuthGuard`
 * ran first and populated `req.user`.
 *
 * - No `@RequireTeamActive` metadata -> allow.
 * - Metadata present but `req.user` missing -> 403 (defensive).
 * - A disabled claim -> 403 without a database query.
 * - Team-only claims are checked against current database state.
 */
@Injectable()
export class TeamActiveGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    if (!req.user || req.user.teamDisabled) {
      throw new ForbiddenException('Acesso negado');
    }

    if (!req.user.isTeamOnly) {
      return true;
    }

    let currentUser: {
      isTeamOnly: boolean;
      teamDisabled: boolean;
    } | null;
    try {
      currentUser = await this.prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { isTeamOnly: true, teamDisabled: true },
      });
    } catch {
      throw new ForbiddenException('Acesso negado');
    }

    if (!currentUser?.isTeamOnly || currentUser.teamDisabled) {
      throw new ForbiddenException('Acesso negado');
    }

    return true;
  }
}
