import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Env } from '../../config/env.validation';
import { SessionService } from '../../redis/session.service';

export type Claims = {
  sub: string;
  email: string;
  role: 'abrigo' | 'voluntario' | 'gerente' | 'admin' | null;
  isTeamOnly: boolean;
  teamDisabled: boolean;
  creatorProfileId: string | null;
  sid: string;
};

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<Env, true>,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Sign a JWT token with the given claims.
   * Uses HS256 algorithm with AUTH_JWT_SECRET and AUTH_ACCESS_TTL.
   */
  async sign(claims: Claims): Promise<string> {
    const secret = this.configService.getOrThrow('AUTH_JWT_SECRET');
    const expiresIn = this.configService.getOrThrow('AUTH_ACCESS_TTL');

    return this.jwtService.signAsync(claims, {
      secret,
      expiresIn,
      algorithm: 'HS256',
    });
  }

  /**
   * Verify a JWT token and return the claims if valid.
   * Returns null if the token is invalid, tampered, expired, garbage, or its
   * session (`sid`) no longer exists. Never throws - always returns Claims
   * or null.
   */
  async verify(token: string): Promise<Claims | null> {
    try {
      const secret = this.configService.getOrThrow('AUTH_JWT_SECRET');
      const decoded = await this.jwtService.verifyAsync<Claims>(token, {
        secret,
        algorithms: ['HS256'],
      });
      // Sem esta checagem, logout, troca/redefinição de senha e desativação
      // de equipe só valeriam quando o access token expirasse.
      if (!(await this.sessions.isActive(decoded.sid))) return null;
      return decoded;
    } catch {
      return null;
    }
  }
}

/* eslint-enable @typescript-eslint/no-unsafe-assignment */
