import { randomBytes, createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import {
  MAX_VERIFIABLE_LENGTH,
  PasswordService,
} from './password/password.service';
import { LegacyMigrationService } from './legacy-migration.service';
import { SessionService } from '../redis/session.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { EmailVerificationService } from './email-verification.service';
import { TokenService, Claims } from './jwt/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeRegisterType } from '../common/utils/register-type';
import { UserOrigin, UserRole } from '../generated/prisma/enums';
import { findLegacyByEmail } from './legacy/legacy-email';
import type { Env } from '../config/env.validation';
import type { RegisterDto } from './dto/register.dto';
import type { User } from '../generated/prisma/client';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pwdResetKey(tokenHash: string): string {
  return `pwdreset:${tokenHash}`;
}

function pwdResetSubjectKey(subject: string): string {
  return `pwdreset_subject:${subject}`;
}

const PWD_RESET_TTL_SECONDS = 60 * 60;
const LEGACY_RESET_PREFIX = 'legacy:';
const INVALID_CREDENTIALS = 'E-mail ou senha inválidos.';
const EMAIL_NOT_VERIFIED = 'E-mail não verificado.';
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_TOO_SHORT = 'A senha deve ter pelo menos 8 caracteres.';
const MAX_PASSWORD_BYTES = 72;
const PASSWORD_TOO_LONG = 'A senha deve ter no máximo 72 caracteres.';
const SELF_REGISTER_ROLES = new Set<UserRole>([
  UserRole.abrigo,
  UserRole.voluntario,
]);
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

function assertPasswordFitsBcrypt(password: string): void {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new BadRequestException({ error: PASSWORD_TOO_LONG });
  }
}

export type LoginResult = {
  userId: string;
  role: Claims['role'];
  migrated: boolean;
  at: string;
  rt: string;
  sid: string;
};

export type RegisterResult = {
  userId: string;
  teamOnly: boolean;
  verificationRequired: boolean;
  at?: string;
  rt?: string;
  sid?: string;
};

export type MeResult = {
  user: {
    id: string;
    email: string;
    role: Claims['role'];
    isTeamOnly: boolean;
    teamDisabled: boolean;
    creatorProfileId: string | null;
  };
};

export type RefreshResult = {
  at: string;
  rt: string;
  sid: string;
};

export type PostLoginRedirectResult = {
  hasShelter: boolean;
  hasVolunteer: boolean;
  hasProfile: boolean;
  redirectTo: '/painel' | '/meu-cadastro';
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly legacyMigrationService: LegacyMigrationService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly config: ConfigService<Env, true>,
    private readonly emailVerificationService: EmailVerificationService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const normalizedEmail = (email ?? '').trim().toLowerCase();
    const normalizedPassword = (password ?? '').trim();

    if (!normalizedEmail || !normalizedPassword) {
      throw new BadRequestException({
        error: 'E-mail e senha são obrigatórios',
      });
    }
    if (normalizedPassword.length > MAX_VERIFIABLE_LENGTH) {
      throw new UnauthorizedException({ error: INVALID_CREDENTIALS });
    }

    let credentialCheckedAt = Date.now();
    const [user, [legacy = null]] = await Promise.all([
      this.usersService.findByEmail(normalizedEmail),
      findLegacyByEmail(this.prisma, normalizedEmail),
    ]);

    let authenticatedUser: User | null = null;
    let migrated: boolean | null = null;

    if (user?.passwordHash) {
      const r = await this.passwordService.verify(
        normalizedPassword,
        user.passwordHash,
      );
      if (r.valid) {
        if (r.needsRehash) {
          const unchanged = await this.rehash(
            user.id,
            normalizedPassword,
            user.passwordHash,
          );
          if (!unchanged)
            throw new UnauthorizedException({ error: INVALID_CREDENTIALS });
        }
        authenticatedUser = user;
        migrated = true;
      }
    }

    if (!authenticatedUser && legacy && legacy.migrated === false) {
      const r = await this.passwordService.verify(
        normalizedPassword,
        legacy.userPass,
      );
      if (r.valid) {
        authenticatedUser = await this.legacyMigrationService.migrate(
          legacy,
          normalizedPassword,
          user,
        );
        migrated = false;
        if (user) {
          await this.sessionService.revokeAll(user.id);
          credentialCheckedAt = Date.now();
        }
      }
    }

    if (!authenticatedUser) {
      if (!user?.passwordHash?.startsWith('$2')) {
        await this.passwordService.burnVerification(normalizedPassword);
      }
      throw new UnauthorizedException({ error: INVALID_CREDENTIALS });
    }

    if (!authenticatedUser.emailVerified) {
      throw new ForbiddenException({
        error: EMAIL_NOT_VERIFIED,
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const role = await this.usersService.resolveRole(authenticatedUser);
    const { sid, rt } = await this.sessionService.create(authenticatedUser.id);
    if (
      await this.sessionService.revokedSince(
        authenticatedUser.id,
        credentialCheckedAt,
      )
    ) {
      await this.sessionService.revoke(sid);
      throw new UnauthorizedException({ error: INVALID_CREDENTIALS });
    }
    const claims: Claims = {
      sub: authenticatedUser.id,
      email: authenticatedUser.email,
      role,
      isTeamOnly: authenticatedUser.isTeamOnly,
      teamDisabled: authenticatedUser.teamDisabled,
      creatorProfileId: authenticatedUser.creatorProfileId,
      sid,
    };
    const at = await this.tokenService.sign(claims);

    return {
      userId: authenticatedUser.id,
      role,
      migrated: migrated as boolean,
      at,
      rt,
      sid,
    };
  }

  async register(
    dto: RegisterDto,
    actor: Claims | null,
  ): Promise<RegisterResult> {
    const normalizedEmail = (dto.email ?? '').trim().toLowerCase();
    const normalizedPassword = (dto.password ?? '').trim();

    if (!normalizedEmail || !normalizedPassword) {
      throw new BadRequestException({
        error: 'E-mail e senha são obrigatórios.',
      });
    }

    if (
      normalizedEmail.length > MAX_EMAIL_LENGTH ||
      !EMAIL_FORMAT.test(normalizedEmail)
    ) {
      throw new BadRequestException({ error: 'E-mail inválido.' });
    }

    if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException({ error: PASSWORD_TOO_SHORT });
    }
    assertPasswordFitsBcrypt(normalizedPassword);

    const requestedRole = normalizeRegisterType(dto.registerType);
    if (requestedRole && !SELF_REGISTER_ROLES.has(requestedRole)) {
      throw new BadRequestException({ error: 'Tipo de cadastro inválido.' });
    }

    const teamOnly = dto.teamOnly === true;
    if (teamOnly && !actor) {
      throw new UnauthorizedException({
        error: 'É necessário estar logado para criar acessos da equipe.',
      });
    }
    if (
      teamOnly &&
      (actor?.role !== UserRole.abrigo ||
        actor.isTeamOnly ||
        actor.teamDisabled)
    ) {
      throw new ForbiddenException({
        error: 'Sem permissão para criar acessos da equipe.',
      });
    }

    const [existing, [legacy]] = await Promise.all([
      this.usersService.findByEmail(normalizedEmail),
      findLegacyByEmail(this.prisma, normalizedEmail),
    ]);
    if (existing || legacy) {
      throw new ConflictException({ error: 'E-mail já cadastrado.' });
    }

    const role = teamOnly
      ? UserRole.abrigo
      : (requestedRole ?? UserRole.abrigo);
    const passwordHash = await this.passwordService.hash(normalizedPassword);

    const created = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        emailVerified: teamOnly,
        role,
        origin: teamOnly
          ? UserOrigin.admin_created
          : UserOrigin.supabase_native,
        isTeamOnly: teamOnly,
        creatorProfileId: teamOnly ? (actor as Claims).sub : null,
      },
    });

    if (teamOnly) {
      return {
        userId: created.id,
        teamOnly: true,
        verificationRequired: false,
      };
    }

    await this.emailVerificationService.issue(created.id, normalizedEmail);

    return {
      userId: created.id,
      teamOnly: false,
      verificationRequired: true,
    };
  }

  async me(claims: Claims | null): Promise<MeResult> {
    if (!claims) {
      throw new UnauthorizedException({ error: 'Não autenticado' });
    }

    return Promise.resolve({
      user: {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        isTeamOnly: claims.isTeamOnly,
        teamDisabled: claims.teamDisabled,
        creatorProfileId: claims.creatorProfileId,
      },
    });
  }

  async postLoginRedirect(
    claims: Claims | null,
  ): Promise<PostLoginRedirectResult> {
    if (!claims) {
      throw new UnauthorizedException({ error: 'Não autenticado' });
    }

    if (claims.role === 'admin') {
      return {
        hasShelter: false,
        hasVolunteer: false,
        hasProfile: false,
        redirectTo: '/painel',
      };
    }

    const [shelter, volunteer] = await Promise.all([
      this.prisma.shelter.findFirst({ where: { profileId: claims.sub } }),
      this.prisma.volunteer.findFirst({
        where: { ownerProfileId: claims.sub },
      }),
    ]);

    const hasShelter = shelter != null;
    const hasVolunteer = volunteer != null;
    const hasProfile = hasShelter || hasVolunteer;

    return {
      hasShelter,
      hasVolunteer,
      hasProfile,
      redirectTo: hasProfile ? '/painel' : '/meu-cadastro',
    };
  }

  async refresh(sid: string, rt: string): Promise<RefreshResult> {
    const rotated = await this.sessionService.rotate(sid, rt);
    if (!rotated) {
      throw new UnauthorizedException({ error: 'Sessão expirada' });
    }

    const userId = await this.sessionService.getUserId(sid);
    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId } })
      : null;

    if (!user) {
      await this.sessionService.revoke(sid);
      throw new UnauthorizedException({ error: 'Sessão expirada' });
    }

    const role = await this.usersService.resolveRole(user);
    const claims: Claims = {
      sub: user.id,
      email: user.email,
      role,
      isTeamOnly: user.isTeamOnly,
      teamDisabled: user.teamDisabled,
      creatorProfileId: user.creatorProfileId,
      sid,
    };
    const at = await this.tokenService.sign(claims);

    return { at, rt: rotated.rt, sid };
  }

  async logout(sid: string | null): Promise<void> {
    if (!sid) {
      return;
    }
    await this.sessionService.revoke(sid);
  }

  async forgotPassword(email: string): Promise<{ ok: true }> {
    const normalizedEmail = (email ?? '').trim().toLowerCase();
    if (!normalizedEmail) return { ok: true };

    const user = await this.usersService.findByEmail(normalizedEmail);
    if (user) {
      await this.sendResetLink(user.email, user.id);
      return { ok: true };
    }

    const [legacy] = await findLegacyByEmail(this.prisma, normalizedEmail, {
      pendingOnly: true,
    });
    if (legacy?.userEmail) {
      await this.sendResetLink(
        legacy.userEmail.toLowerCase(),
        `${LEGACY_RESET_PREFIX}${legacy.id}`,
      );
    }

    return { ok: true };
  }

  private async sendResetLink(email: string, subject: string): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);

    await this.redisService.client
      .multi()
      .set(pwdResetKey(tokenHash), subject, 'EX', PWD_RESET_TTL_SECONDS)
      .sadd(pwdResetSubjectKey(subject), tokenHash)
      .expire(pwdResetSubjectKey(subject), PWD_RESET_TTL_SECONDS)
      .exec();

    const resetLink = new URL(
      '/redefinir-senha',
      this.config.get('APP_URL', { infer: true }),
    );
    resetLink.searchParams.set('token', token);
    void this.mailService.sendPasswordReset(email, resetLink.toString());
  }

  async verifyEmail(token: string, password: string): Promise<{ ok: true }> {
    const result = await this.emailVerificationService.confirm(token, password);
    if (result === 'wrong_password') {
      throw new BadRequestException({
        error: 'Senha incorreta.',
        code: 'INVALID_PASSWORD',
      });
    }
    if (result === 'invalid') {
      throw new BadRequestException({ error: 'Link inválido ou expirado' });
    }
    return { ok: true };
  }

  async resendVerification(email: string): Promise<{ ok: true }> {
    await this.emailVerificationService.resend(email);
    return { ok: true };
  }

  async resetPassword(token: string, password: string): Promise<{ ok: true }> {
    const normalizedPassword = (password ?? '').trim();
    if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException({ error: PASSWORD_TOO_SHORT });
    }
    assertPasswordFitsBcrypt(normalizedPassword);

    const subject = await this.redisService.client.getdel(
      pwdResetKey(sha256(token ?? '')),
    );
    if (!subject) {
      throw new BadRequestException({ error: 'Link inválido ou expirado' });
    }

    const userId = subject.startsWith(LEGACY_RESET_PREFIX)
      ? await this.resetLegacyPassword(
          BigInt(subject.slice(LEGACY_RESET_PREFIX.length)),
          normalizedPassword,
        )
      : await this.setNewPassword(subject, normalizedPassword);

    await this.invalidateResetTokens(subject, userId);
    await this.sessionService.revokeAll(userId);
    await this.notifyPasswordChanged(userId);

    return { ok: true };
  }

  private async notifyPasswordChanged(userId: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (user) void this.mailService.sendPasswordChanged(user.email);
    } catch (err) {
      this.logger.error(
        `Falha ao avisar troca de senha do usuário ${userId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async invalidateResetTokens(...subjects: string[]): Promise<void> {
    const keys = [...new Set(subjects)].map(pwdResetSubjectKey);
    const hashes = (
      await Promise.all(
        keys.map((key) => this.redisService.client.smembers(key)),
      )
    ).flat();
    await this.redisService.client.del(...keys, ...hashes.map(pwdResetKey));
  }

  private async setNewPassword(
    userId: string,
    plainPassword: string,
  ): Promise<string> {
    const passwordHash = await this.passwordService.hash(plainPassword);
    await this.legacyMigrationService.setPassword(userId, passwordHash, {
      claimLegacy: true,
    });
    return userId;
  }

  private async resetLegacyPassword(
    legacyId: bigint,
    plainPassword: string,
  ): Promise<string> {
    const legacy = await this.prisma.wpUserLegacy.findUnique({
      where: { id: legacyId },
    });
    const existingUser = legacy?.userEmail
      ? await this.usersService.findByEmail(legacy.userEmail)
      : null;

    if (legacy && !legacy.migrated) {
      const user = await this.legacyMigrationService.migrate(
        legacy,
        plainPassword,
        existingUser,
      );
      return user.id;
    }

    if (!existingUser) {
      throw new BadRequestException({ error: 'Link inválido ou expirado' });
    }
    return this.setNewPassword(existingUser.id, plainPassword);
  }

  async changePassword(
    claims: Claims | null,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    if (!claims) {
      throw new UnauthorizedException({ error: 'Não autenticado' });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
    });
    const verification = user
      ? await this.passwordService.verify(currentPassword, user.passwordHash)
      : { valid: false, needsRehash: false };

    if (!verification.valid) {
      throw new BadRequestException({ error: 'Senha atual incorreta.' });
    }

    const normalizedNewPassword = (newPassword ?? '').trim();
    if (normalizedNewPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException({ error: PASSWORD_TOO_SHORT });
    }
    assertPasswordFitsBcrypt(normalizedNewPassword);

    const passwordHash = await this.passwordService.hash(normalizedNewPassword);
    await this.legacyMigrationService.setPassword(
      (user as User).id,
      passwordHash,
      { claimLegacy: false },
    );
    await this.invalidateResetTokens(claims.sub);
    await this.sessionService.revokeAll(claims.sub, claims.sid);
    void this.mailService.sendPasswordChanged((user as User).email);

    return { ok: true };
  }

  private async rehash(
    userId: string,
    plainPassword: string,
    previousHash: string,
  ): Promise<boolean> {
    try {
      const newHash = await this.passwordService.hash(plainPassword);
      const updated = await this.prisma.user.updateMany({
        where: { id: userId, passwordHash: previousHash },
        data: { passwordHash: newHash },
      });
      return updated.count === 1;
    } catch (err) {
      this.logger.error(
        `Falha ao regravar passwordHash do usuário ${userId} após rehash`,
        err instanceof Error ? err.stack : String(err),
      );
      return true;
    }
  }
}
