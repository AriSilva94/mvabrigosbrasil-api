import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Env } from '../../config/env.validation';
import { clearAuthCookies, setAuthCookies } from './cookies';

describe('Auth Cookies', () => {
  let mockRes: {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };
  let mockConfig: ConfigService<Env, true>;

  beforeEach(() => {
    mockRes = {
      cookie: jest.fn().mockReturnValue(undefined),
      clearCookie: jest.fn().mockReturnValue(undefined),
    };
    mockConfig = {
      get: jest.fn(),
    } as unknown as ConfigService<Env, true>;
  });

  describe('setAuthCookies', () => {
    it('should set mv_at cookie with correct options when COOKIE_SECURE is false', () => {
      (mockConfig.get as jest.Mock).mockReturnValue(false);

      setAuthCookies(
        mockRes as unknown as Response,
        { at: 'access-token-value', rt: 'refresh-token-value' },
        mockConfig,
      );

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'mv_at',
        'access-token-value',
        expect.objectContaining({
          path: '/',
          maxAge: 900000, // 15 minutes in milliseconds
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
        }),
      );
    });

    it('should set mv_rt cookie with correct options when COOKIE_SECURE is false', () => {
      (mockConfig.get as jest.Mock).mockReturnValue(false);

      setAuthCookies(
        mockRes as unknown as Response,
        { at: 'access-token-value', rt: 'refresh-token-value' },
        mockConfig,
      );

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'mv_rt',
        'refresh-token-value',
        expect.objectContaining({
          path: '/',
          maxAge: 2592000000, // 30 days in milliseconds
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
        }),
      );
    });

    it('should set mv_at cookie with secure: true when COOKIE_SECURE is true', () => {
      (mockConfig.get as jest.Mock).mockReturnValue(true);

      setAuthCookies(
        mockRes as unknown as Response,
        { at: 'access-token-value', rt: 'refresh-token-value' },
        mockConfig,
      );

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'mv_at',
        'access-token-value',
        expect.objectContaining({
          path: '/',
          maxAge: 900000,
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
        }),
      );
    });

    it('should set mv_rt cookie with secure: true when COOKIE_SECURE is true', () => {
      (mockConfig.get as jest.Mock).mockReturnValue(true);

      setAuthCookies(
        mockRes as unknown as Response,
        { at: 'access-token-value', rt: 'refresh-token-value' },
        mockConfig,
      );

      expect(mockRes.cookie).toHaveBeenCalledWith(
        'mv_rt',
        'refresh-token-value',
        expect.objectContaining({
          path: '/',
          maxAge: 2592000000,
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
        }),
      );
    });

    it('should call res.cookie exactly twice', () => {
      (mockConfig.get as jest.Mock).mockReturnValue(false);

      setAuthCookies(
        mockRes as unknown as Response,
        { at: 'access-token-value', rt: 'refresh-token-value' },
        mockConfig,
      );

      expect(mockRes.cookie).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearAuthCookies', () => {
    it('should clear mv_at cookie with path /', () => {
      (mockConfig.get as jest.Mock).mockReturnValue(false);

      clearAuthCookies(mockRes as unknown as Response, mockConfig);

      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'mv_at',
        expect.objectContaining({
          path: '/',
        }),
      );
    });

    it('should clear mv_rt cookie with path / and secure: false', () => {
      (mockConfig.get as jest.Mock).mockReturnValue(false);

      clearAuthCookies(mockRes as unknown as Response, mockConfig);

      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'mv_rt',
        expect.objectContaining({
          path: '/',
          secure: false,
        }),
      );
    });

    it('should call clearCookie exactly twice', () => {
      (mockConfig.get as jest.Mock).mockReturnValue(false);

      clearAuthCookies(mockRes as unknown as Response, mockConfig);

      expect(mockRes.clearCookie).toHaveBeenCalledTimes(2);
    });

    it('should clear both cookies with matching paths regardless of COOKIE_SECURE value', () => {
      (mockConfig.get as jest.Mock).mockReturnValue(true);

      clearAuthCookies(mockRes as unknown as Response, mockConfig);

      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'mv_at',
        expect.objectContaining({
          path: '/',
        }),
      );
      expect(mockRes.clearCookie).toHaveBeenCalledWith(
        'mv_rt',
        expect.objectContaining({
          path: '/',
          secure: true,
        }),
      );
    });
  });
});
