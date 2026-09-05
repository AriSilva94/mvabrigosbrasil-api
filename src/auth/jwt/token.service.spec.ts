import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import * as jwt from 'jsonwebtoken';
import { TokenService, Claims } from './token.service';
import { Env } from '../../config/env.validation';

describe('TokenService', () => {
  let tokenService: TokenService;
  let jwtService: JwtService;

  const mockEnv: Env = {
    NODE_ENV: 'test' as const,
    PORT: 3001,
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    AUTH_JWT_SECRET: 'my-secret-key-that-is-at-least-32-characters-long!!',
    AUTH_ACCESS_TTL: '15m',
    AUTH_REFRESH_TTL: '30d',
    COOKIE_SECURE: false,
    APP_URL: 'http://localhost:3001',
    BCRYPT_COST: 10,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: mockEnv.AUTH_JWT_SECRET,
          signOptions: {
            expiresIn: mockEnv.AUTH_ACCESS_TTL as StringValue,
            algorithm: 'HS256',
          },
        }),
      ],
      providers: [
        TokenService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: keyof Env) => mockEnv[key],
            getOrThrow: (key: keyof Env) => {
              const value = mockEnv[key];
              if (value === undefined) {
                throw new Error(`Config key ${key} not found`);
              }
              return value;
            },
          },
        },
      ],
    }).compile();

    tokenService = module.get<TokenService>(TokenService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('sign', () => {
    it('should produce a valid JWT token with HS256 algorithm', async () => {
      const claims: Claims = {
        sub: 'user-123',
        email: 'user@example.com',
        role: 'admin',
        isTeamOnly: false,
        teamDisabled: false,
        creatorProfileId: 'profile-456',
        sid: 'session-789',
      };

      const token = await tokenService.sign(claims);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      // Decode without verification to check structure
      const decoded: Record<string, unknown> | null = jwtService.decode(token);
      expect(decoded).toBeDefined();
      if (decoded) {
        expect(decoded.sub).toBe(claims.sub);
        expect(decoded.email).toBe(claims.email);
        expect(decoded.iat).toBeDefined();
        expect(decoded.exp).toBeDefined();
      }
    });

    it('should include expiry based on AUTH_ACCESS_TTL', async () => {
      const claims: Claims = {
        sub: 'user-123',
        email: 'user@example.com',
        role: 'voluntario',
        isTeamOnly: true,
        teamDisabled: false,
        creatorProfileId: null,
        sid: 'session-789',
      };

      const token = await tokenService.sign(claims);
      const decoded: Record<string, number | undefined> | null =
        jwtService.decode(token);

      if (decoded) {
        expect(decoded.exp).toBeDefined();
        expect(decoded.iat).toBeDefined();
        // For a 15m token, exp - iat should be close to 900 seconds (15 * 60)
        const exp = decoded.exp ?? 0;
        const iat = decoded.iat ?? 0;
        const expiryDuration = exp - iat;
        expect(expiryDuration).toBeGreaterThan(890); // Allow some margin
        expect(expiryDuration).toBeLessThan(910);
      }
    });
  });

  describe('verify', () => {
    it('should return claims when verifying own token', async () => {
      const claims: Claims = {
        sub: 'user-123',
        email: 'user@example.com',
        role: 'abrigo',
        isTeamOnly: false,
        teamDisabled: true,
        creatorProfileId: 'profile-456',
        sid: 'session-789',
      };

      const token = await tokenService.sign(claims);
      const verified = await tokenService.verify(token);

      expect(verified).toBeDefined();
      expect(verified?.sub).toBe(claims.sub);
      expect(verified?.email).toBe(claims.email);
      expect(verified?.role).toBe(claims.role);
      expect(verified?.isTeamOnly).toBe(claims.isTeamOnly);
      expect(verified?.teamDisabled).toBe(claims.teamDisabled);
      expect(verified?.creatorProfileId).toBe(claims.creatorProfileId);
      expect(verified?.sid).toBe(claims.sid);
    });

    it('should return null when verifying tampered token', async () => {
      const claims: Claims = {
        sub: 'user-123',
        email: 'user@example.com',
        role: 'gerente',
        isTeamOnly: false,
        teamDisabled: false,
        creatorProfileId: null,
        sid: 'session-789',
      };

      const token = await tokenService.sign(claims);
      const tamperedToken = token.slice(0, -10) + 'TAMPERED!';

      const verified = await tokenService.verify(tamperedToken);

      expect(verified).toBeNull();
    });

    it('should return null for garbage string', async () => {
      const verified = await tokenService.verify('not.a.token');

      expect(verified).toBeNull();
    });

    it('should return null for empty string', async () => {
      const verified = await tokenService.verify('');

      expect(verified).toBeNull();
    });

    it('should return null for expired token', async () => {
      const claims: Claims = {
        sub: 'user-123',
        email: 'user@example.com',
        role: null,
        isTeamOnly: false,
        teamDisabled: false,
        creatorProfileId: null,
        sid: 'session-789',
      };

      // Create a token that's already expired (exp in the past)
      const now = Math.floor(Date.now() / 1000);
      const expiredClaims = {
        ...claims,
        iat: now - 200,
        exp: now - 100, // Expired 100 seconds ago
      };

      // Manually create an expired token using raw jwt
      const secret = mockEnv.AUTH_JWT_SECRET;
      const expiredToken = jwt.sign(expiredClaims, secret, {
        algorithm: 'HS256',
      });

      // Verify should return null for expired token
      const verified = await tokenService.verify(expiredToken);

      expect(verified).toBeNull();
    });
  });
});
