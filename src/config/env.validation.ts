import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  AUTH_JWT_SECRET: z
    .string()
    .min(32, 'AUTH_JWT_SECRET must have at least 32 chars'),
  AUTH_ACCESS_TTL: z.string().default('15m'),
  AUTH_REFRESH_TTL: z.string().default('30d'),
  COOKIE_SECURE: bool.default(false),
  APP_URL: z.string().url(),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: bool.optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  // Segredo compartilhado com o Next para isentar suas chamadas server-side
  // do rate limit (ver `isInternalRequest`).
  INTERNAL_API_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(32).optional(),
  ),
});

// Cookie de sessão sem Secure atrás de HTTPS viaja em texto claro em
// qualquer requisição http (ex.: link antigo, downgrade de rede).
const envWithInvariants = envSchema.superRefine((env, ctx) => {
  if (
    env.NODE_ENV === 'production' &&
    env.APP_URL.startsWith('https:') &&
    !env.COOKIE_SECURE
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'must be true in production when APP_URL is https',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envWithInvariants.safeParse(config);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  return parsed.data;
}
