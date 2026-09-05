import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../../config/env.validation';

const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });

  // Set refresh token cookie
  res.cookie('mv_rt', tokens.rt, {
    ...commonOptions,
    path: '/api/v1/auth',
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
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
    path: '/api/v1/auth',
  });
}
