import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route/handler as not requiring authentication.
 * `JwtAuthGuard` skips the token check entirely for `@Public()` routes.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
