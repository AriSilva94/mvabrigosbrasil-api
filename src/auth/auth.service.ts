import { randomBytes, createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password/password.service';
import { LegacyMigrationService } from './legacy-migration.service';
import { SessionService } from '../redis/session.service';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { TokenService, Claims } from './jwt/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeRegisterType } from '../common/utils/register-type';
import { UserOrigin } from '../generated/prisma/enums';
import type { Env } from '../config/env.validation';
import type { RegisterDto } from './dto/register.dto';
import type { User } from '../generated/prisma/client';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function pwdResetKey(tokenHash: string): string {
  return `pwdreset:${tokenHash}`;
}

// Doc 03 §10: link válido por 60 minutos, uso único.
const PWD_RESET_TTL_SECONDS = 60 * 60;
const MIN_PASSWORD_LENGTH = 6;

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
  // Presentes apenas quando `teamOnly === false` (uma sessão é emitida para
  // o usuário recém-criado, igual ao fluxo de login). Quando `teamOnly ===
  // true`, quem fica logado é o criador (actor), então nenhuma sessão nova
  // é emitida para o usuário da equipe.
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

// Implementa o algoritmo de login descrito em doc 03 §5 (R1-R4):
// R1 - usuário nativo/importado com passwordHash válido no bcrypt (ou que
//      precise de rehash de um formato legado gravado por import parcial).
// R2 - fallback para o legado do WordPress ainda não migrado
//      (`wp_users_legacy.migrated === false`).
// R3 - legado já migrado nunca é consultado de novo (corrige o quirk do
//      fluxo antigo que sobrescrevia senha nova com a senha WP antiga).
// R4 - 401 se alguma das duas populações existe mas a senha não bateu,
//      404 se nenhuma delas existe (paridade com o comportamento atual).
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
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const normalizedEmail = (email ?? '').trim().toLowerCase();
    const normalizedPassword = (password ?? '').trim();

    if (!normalizedEmail || !normalizedPassword) {
      throw new BadRequestException({
        error: 'E-mail e senha são obrigatórios',
      });
    }

    const user = await this.usersService.findByEmail(normalizedEmail);
    const legacy = await this.prisma.wpUserLegacy.findFirst({
      where: { userEmail: { equals: normalizedEmail, mode: 'insensitive' } },
    });

    let authenticatedUser: User | null = null;
    let migrated: boolean | null = null;

    // R1
    if (user?.passwordHash) {
      const r = await this.passwordService.verify(
        normalizedPassword,
        user.passwordHash,
      );
      if (r.valid) {
        if (r.needsRehash) {
          await this.rehash(user.id, normalizedPassword);
        }
        authenticatedUser = user;
        migrated = true;
      }
    }

    // R2 (só roda se R1 não autenticou e o legado ainda não foi migrado —
    // R3: `migrated === true` nunca cai aqui, então `user_pass` não é lido)
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
      }
    }

    // R4
    if (!authenticatedUser) {
      if (user || legacy) {
        throw new UnauthorizedException({ error: 'Senha inválida' });
      }
      throw new NotFoundException({ error: 'Usuário não encontrado' });
    }

    const role = await this.usersService.resolveRole(authenticatedUser);
    const { sid, rt } = await this.sessionService.create(authenticatedUser.id);
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

  // Doc 05 §3.1. `actor` são as claims da sessão atual (se houver), lidas do
  // cookie `mv_at` pelo controller — ainda não há `JwtAuthGuard` global
  // (Task 11), então este é o único jeito de saber quem está logado ao
  // registrar um acesso de equipe (`teamOnly`).
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

    if (normalizedPassword.length < 8) {
      throw new BadRequestException({
        error: 'A senha deve ter pelo menos 8 caracteres.',
      });
    }

    const existing = await this.usersService.findByEmail(normalizedEmail);
    if (existing) {
      throw new ConflictException({ error: 'E-mail já cadastrado.' });
    }

    const teamOnly = dto.teamOnly === true;
    if (teamOnly && !actor) {
      throw new UnauthorizedException({
        error: 'É necessário estar logado para criar acessos da equipe.',
      });
    }

    const role = normalizeRegisterType(dto.registerType) ?? 'abrigo';
    const passwordHash = await this.passwordService.hash(normalizedPassword);

    const created = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        emailVerified: true,
        role,
        origin: teamOnly
          ? UserOrigin.admin_created
          : UserOrigin.supabase_native,
        isTeamOnly: teamOnly,
        creatorProfileId: teamOnly ? (actor as Claims).sub : null,
      },
    });

    // teamOnly: o criador (actor) segue logado como ele mesmo — nenhuma
    // sessão nova é emitida para o usuário de equipe recém-criado.
    if (teamOnly) {
      return { userId: created.id, teamOnly: true };
    }

    const { sid, rt } = await this.sessionService.create(created.id);
    const claims: Claims = {
      sub: created.id,
      email: normalizedEmail,
      role,
      isTeamOnly: false,
      teamDisabled: false,
      creatorProfileId: null,
      sid,
    };
    const at = await this.tokenService.sign(claims);

    return { userId: created.id, teamOnly: false, at, rt, sid };
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

  // Doc 03 §7, §10 / doc 05 §3.1. `sid`/`rt` vêm do cookie `mv_rt`
  // (`${sid}.${rt}`, convenção da task 7), já separados pelo controller.
  // `SessionService.rotate` aceita duplicatas apenas na janela curta de
  // concorrência; fora dela, um `rt` rotacionado (ou desconhecido) devolve
  // `null` e destrói a sessão. As claims do novo access token são recarregadas
  // do banco (não do token antigo) para refletir `role`/`teamDisabled` atuais.
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
      // Usuário foi removido entre o login e o refresh: não há claims
      // válidas para reconstruir. Revoga a sessão órfã por higiene e trata
      // como sessão expirada.
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

  // Idempotente: funciona sem sessão (sid nulo/desconhecido) — o controller
  // sempre limpa os cookies e responde 200, com ou sem sessão ativa.
  async logout(sid: string | null): Promise<void> {
    if (!sid) {
      return;
    }
    await this.sessionService.revoke(sid);
  }

  // Doc 03 §10 / doc 05 §3.1. Nunca revela se o e-mail existe: sempre
  // resolve com `{ ok: true }`, com ou sem usuário encontrado. Quando o
  // usuário existe, gera um token opaco de 32 bytes, grava no Redis só o
  // HASH (sha256) do token com TTL de 60 min, e envia o link (com o token em
  // texto puro) por e-mail — o token puro nunca é persistido em lugar
  // nenhum.
  async forgotPassword(email: string): Promise<{ ok: true }> {
    const normalizedEmail = (email ?? '').trim().toLowerCase();
    if (normalizedEmail) {
      const user = await this.usersService.findByEmail(normalizedEmail);
      if (user) {
        const token = randomBytes(32).toString('base64url');
        const tokenHash = sha256(token);

        await this.redisService.client.set(
          pwdResetKey(tokenHash),
          user.id,
          'EX',
          PWD_RESET_TTL_SECONDS,
        );

        const appUrl = this.config.get('APP_URL', { infer: true });
        const link = `${appUrl}/redefinir-senha?token=${token}`;
        await this.mailService.sendPasswordReset(user.email, link);
      }
    }

    return { ok: true };
  }

  // Doc 03 §10 / doc 05 §3.1. Uso único: a chave `pwdreset:{sha256(token)}`
  // é apagada assim que consumida (com sucesso), e `revokeAll` derruba todas
  // as sessões existentes do usuário (login forçado em qualquer dispositivo
  // depois de uma troca de senha via recuperação).
  async resetPassword(token: string, password: string): Promise<{ ok: true }> {
    const normalizedPassword = (password ?? '').trim();
    if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException({
        error: 'A senha deve ter no mínimo 6 caracteres.',
      });
    }

    const key = pwdResetKey(sha256(token ?? ''));
    const userId = await this.redisService.client.get(key);
    if (!userId) {
      throw new BadRequestException({ error: 'Link inválido ou expirado' });
    }

    const passwordHash = await this.passwordService.hash(normalizedPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    await this.redisService.client.del(key);
    await this.sessionService.revokeAll(userId);

    return { ok: true };
  }

  // Doc 03 §10 / doc 05 §3.1. Exige sessão (`claims` vem do cookie `mv_at`,
  // lido pelo controller). Ao contrário de `resetPassword` (que derruba
  // TODAS as sessões — o usuário não sabe a senha, então nenhum dispositivo
  // é confiável), aqui a sessão atual (`claims.sid`) é preservada: o usuário
  // provou conhecer a senha atual, então só as OUTRAS sessões são revogadas.
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
      throw new BadRequestException({
        error: 'A senha deve ter no mínimo 6 caracteres.',
      });
    }

    const passwordHash = await this.passwordService.hash(normalizedNewPassword);
    await this.prisma.user.update({
      where: { id: (user as User).id },
      data: { passwordHash },
    });
    await this.sessionService.revokeAll(claims.sub, claims.sid);

    return { ok: true };
  }

  // Rehash de senha legada gravada em `users.passwordHash` (import parcial —
  // doc 03 §8). Falha aqui NÃO bloqueia o login (doc 03 §5): apenas loga e
  // segue, pois a senha já foi validada contra o hash antigo.
  private async rehash(userId: string, plainPassword: string): Promise<void> {
    try {
      const newHash = await this.passwordService.hash(plainPassword);
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
      });
    } catch (err) {
      this.logger.error(
        `Falha ao regravar passwordHash do usuário ${userId} após rehash`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
