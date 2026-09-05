import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public';
import { TokenService, Claims } from '../jwt/token.service';

const BEARER_PREFIX = 'Bearer ';

/**
 * Reads the access token from the `mv_at` cookie (fallback: `Authorization:
 * Bearer <token>` header), validates it via `TokenService`, and populates
 * `req.user` with the resulting claims.
 *
 * `@Public()` routes skip the auth requirement entirely: no token is
 * required and the request is always allowed through.
 *
 * NOTE: not registered as a global `APP_GUARD` yet — that happens in
 * Task 11 (AuthModule wiring), once `@Public()` markers exist on every
 * route that needs them.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: Claims }>();

    const token = this.extractToken(req);

    if (!token) {
      if (isPublic) {
        return true;
      }
      throw new UnauthorizedException('Não autenticado');
    }

    const claims = await this.tokenService.verify(token);

    if (!claims) {
      if (isPublic) {
        return true;
      }
      throw new UnauthorizedException('Não autenticado');
    }

    req.user = claims;
    return true;
  }

  private extractToken(req: Request): string | null {
    const cookies = req.cookies as Record<string, string> | undefined;
    const cookieToken = cookies?.mv_at;
    if (cookieToken) {
      return cookieToken;
    }

    const authHeader = req.headers?.authorization;
    if (authHeader?.startsWith(BEARER_PREFIX)) {
      return authHeader.slice(BEARER_PREFIX.length).trim() || null;
    }

    return null;
  }
}
