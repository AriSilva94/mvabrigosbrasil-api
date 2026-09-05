import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Claims } from '../jwt/token.service';
import type { Request } from 'express';

/**
 * Returns `req.user` (the `Claims` populated by `JwtAuthGuard`).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Claims | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: Claims }>();
    return req.user;
  },
);
