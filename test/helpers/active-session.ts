import type { INestApplication } from '@nestjs/common';
import { TokenService, type Claims } from '../../src/auth/jwt/token.service';
import { RedisService } from '../../src/redis/redis.service';
import { sessionKey } from '../../src/redis/session.keys';

// Os e2e cunham access tokens sem passar pelo login. Como `TokenService.verify`
// exige que o `sid` exista no Redis, cada token assinado aqui ganha uma
// sessão de curta duração (expira sozinha, sem limpeza manual).
const TEST_SESSION_TTL_SECONDS = 600;

export async function registerTestSession(
  app: INestApplication,
  claims: Pick<Claims, 'sid' | 'sub'>,
): Promise<void> {
  await app.get(RedisService).client.set(
    sessionKey(claims.sid),
    JSON.stringify({
      userId: claims.sub,
      rtHash: 'e2e',
      createdAt: Date.now(),
    }),
    'EX',
    TEST_SESSION_TTL_SECONDS,
  );
}

export function tokensWithSessions(app: INestApplication): TokenService {
  const tokens = app.get(TokenService);
  const wrapper = Object.create(tokens) as TokenService;

  wrapper.sign = async (claims: Claims) => {
    await registerTestSession(app, claims);
    return tokens.sign(claims);
  };

  return wrapper;
}
