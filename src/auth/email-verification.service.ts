import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import {
  MAX_VERIFIABLE_LENGTH,
  PasswordService,
} from './password/password.service';
import type { Env } from '../config/env.validation';

export type ConfirmResult = 'ok' | 'invalid' | 'wrong_password';

const VERIFICATION_TTL_SECONDS = 24 * 60 * 60;
const RESEND_COOLDOWN_SECONDS = 60;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenKey(tokenHash: string): string {
  return `emailverify:${tokenHash}`;
}

// Hash do link vigente de cada usuário, para um novo envio invalidar o anterior.
function userKey(userId: string): string {
  return `emailverify_user:${userId}`;
}

function cooldownKey(userId: string): string {
  return `emailverify_cooldown:${userId}`;
}

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly mailService: MailService,
    private readonly config: ConfigService<Env, true>,
    private readonly passwordService: PasswordService,
  ) {}

  async issue(userId: string, email: string): Promise<void> {
    const redis = this.redisService.client;
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);

    const previousHash = await redis.get(userKey(userId));
    await redis.set(
      tokenKey(tokenHash),
      userId,
      'EX',
      VERIFICATION_TTL_SECONDS,
    );
    await redis.set(userKey(userId), tokenHash, 'EX', VERIFICATION_TTL_SECONDS);
    if (previousHash) {
      await redis.del(tokenKey(previousHash));
    }

    const link = new URL(
      '/confirmar-email',
      this.config.get('APP_URL', { infer: true }),
    );
    link.searchParams.set('token', token);
    void this.mailService.sendEmailVerification(email, link.toString());
  }

  // Exige a senha do cadastro: o link sozinho não pode ativar conta criada por terceiros.
  async confirm(token: string, password: string): Promise<ConfirmResult> {
    const key = tokenKey(sha256(token ?? ''));
    const userId = await this.redisService.client.get(key);
    if (!userId) return 'invalid';

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return 'invalid';

    const plain = (password ?? '').trim();
    const passwordOk =
      plain.length > 0 &&
      plain.length <= MAX_VERIFIABLE_LENGTH &&
      user.passwordHash !== null &&
      (await this.passwordService.verify(plain, user.passwordHash)).valid;
    if (!passwordOk) return 'wrong_password';

    // GETDEL: duas requisições simultâneas com o mesmo link não passam as duas.
    if (!(await this.redisService.client.getdel(key))) return 'invalid';

    const { count } = await this.prisma.user.updateMany({
      where: { id: userId },
      data: { emailVerified: true },
    });
    await this.redisService.client.del(userKey(userId));
    return count > 0 ? 'ok' : 'invalid';
  }

  async resend(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email ?? '');
    if (!user || user.emailVerified) return;

    const accepted = await this.redisService.client.set(
      cooldownKey(user.id),
      '1',
      'EX',
      RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (!accepted) return;

    await this.issue(user.id, user.email);
  }
}
