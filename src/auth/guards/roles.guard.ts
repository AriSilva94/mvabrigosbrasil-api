import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY, Role } from '../decorators/roles';
import { Claims } from '../jwt/token.service';

/**
 * Enforces `@Roles(...)` on a route/handler. Assumes `JwtAuthGuard` ran
 * first and populated `req.user`.
 *
 * - No `@Roles` metadata -> allow (any authenticated user, or none).
 * - `@Roles` present but `req.user` missing -> 403 (defensive; should not
 *   normally happen once `JwtAuthGuard` is registered globally).
 * - `@Roles` present and `req.user.role` not in the allowed set -> 403.
 *
 * NOTE: not registered as a global `APP_GUARD` yet — see Task 11.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: Claims }>();

    const user = req.user;

    if (!user || !user.role || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Acesso negado');
    }

    return true;
  }
}
