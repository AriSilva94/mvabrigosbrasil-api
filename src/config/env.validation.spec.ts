import { validateEnv } from './env.validation';

const base = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL: 'postgresql://mv:mv@localhost:5432/mvabrigos',
  REDIS_URL: 'redis://:mv@localhost:6379/0',
  AUTH_JWT_SECRET: 'x'.repeat(64),
  APP_URL: 'http://localhost:3000',
};

describe('validateEnv', () => {
  it('accepts valid config and applies defaults', () => {
    const env = validateEnv(base);
    expect(env.PORT).toBe(3001);
    expect(env.AUTH_ACCESS_TTL).toBe('15m');
    expect(env.AUTH_REFRESH_TTL).toBe('30d');
    expect(env.BCRYPT_COST).toBe(10);
    expect(env.COOKIE_SECURE).toBe(false);
  });

  it('coerces COOKIE_SECURE and BCRYPT_COST', () => {
    const env = validateEnv({
      ...base,
      COOKIE_SECURE: 'true',
      BCRYPT_COST: '12',
    });
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.BCRYPT_COST).toBe(12);
  });

  it('rejects short AUTH_JWT_SECRET', () => {
    expect(() => validateEnv({ ...base, AUTH_JWT_SECRET: 'short' })).toThrow(
      /AUTH_JWT_SECRET/,
    );
  });

  it('treats an empty INTERNAL_API_TOKEN as not configured', () => {
    expect(
      validateEnv({ ...base, INTERNAL_API_TOKEN: '' }).INTERNAL_API_TOKEN,
    ).toBeUndefined();
  });

  it('rejects an INTERNAL_API_TOKEN shorter than 32 chars', () => {
    expect(() => validateEnv({ ...base, INTERNAL_API_TOKEN: 'short' })).toThrow(
      /INTERNAL_API_TOKEN/,
    );
  });

  it('rejects COOKIE_SECURE=false in production behind https', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        APP_URL: 'https://mvabrigosbrasil.com.br',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow(/COOKIE_SECURE/);
  });

  it('accepts COOKIE_SECURE=false in production over plain http (local compose)', () => {
    expect(
      validateEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' })
        .COOKIE_SECURE,
    ).toBe(false);
  });

  it('rejects missing REDIS_URL', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { REDIS_URL, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/REDIS_URL/);
  });
});
