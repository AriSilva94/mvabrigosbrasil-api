import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../../config/env.validation';
import { parseDurationToSeconds } from '../../redis/session.service';

// Mesma duração do JWT e da sessão no Redis: valores fixos aqui divergiam
// de AUTH_ACCESS_TTL/AUTH_REFRESH_TTL quando o ambiente os alterava.
function maxAgeMs(
  config: ConfigService<Env, true>,
  key: 'AUTH_ACCESS_TTL' | 'AUTH_REFRESH_TTL',
): number {
  return parseDurationToSeconds(config.get(key, { infer: true })) * 1000;
}

/**
 * Sets both access and refresh token cookies on the response.
 *
 * @param res Express Response object
 * @param tokens Object containing at (access token) and rt (refresh token)
 * @param config NestJS ConfigService with Env type
 */
export function setAuthCookies(
  res: Response,
  tokens: { at: string; rt: string },
  config: ConfigService<Env, true>,
): void {
  const cookieSecure = config.get('COOKIE_SECURE', { infer: true });

  const commonOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cookieSecure,
  };

  // Set access token cookie
  res.cookie('mv_at', tokens.at, {
    ...commonOptions,
    path: '/',
    maxAge: maxAgeMs(config, 'AUTH_ACCESS_TTL'),
  });

  // Set refresh token cookie
  res.cookie('mv_rt', tokens.rt, {
    ...commonOptions,
    path: '/',
    maxAge: maxAgeMs(config, 'AUTH_REFRESH_TTL'),
  });
}

/**
 * Clears both access and refresh token cookies from the response.
 * Note: The path must match the path used when setting the cookie.
 *
 * @param res Express Response object
 * @param config NestJS ConfigService with Env type
 */
export function clearAuthCookies(
  res: Response,
  config: ConfigService<Env, true>,
): void {
  const cookieSecure = config.get('COOKIE_SECURE', { infer: true });

  const commonOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: cookieSecure,
  };

  // Clear access token cookie (must use same path as when set)
  res.clearCookie('mv_at', {
    ...commonOptions,
    path: '/',
  });

  // Clear refresh token cookie (must use same path as when set)
  res.clearCookie('mv_rt', {
    ...commonOptions,
    path: '/',
  });
}
