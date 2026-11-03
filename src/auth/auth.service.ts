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

// Tokens emitidos por titular, para invalidar os links ainda pendentes quando
// a senha muda por qualquer caminho.
function pwdResetSubjectKey(subject: string): string {
  return `pwdreset_subject:${subject}`;
}

// Doc 03 §10: link válido por 60 minutos, uso único.
const PWD_RESET_TTL_SECONDS = 60 * 60;
const LEGACY_RESET_PREFIX = 'legacy:';
// Mesma resposta para e-mail inexistente e senha errada: o login não pode
// servir para descobrir quem tem conta.
const INVALID_CREDENTIALS = 'E-mail ou senha inválidos.';
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_TOO_SHORT = 'A senha deve ter pelo menos 8 caracteres.';
// O bcrypt ignora tudo depois do 72º byte: senhas maiores dariam a falsa
// impressão de que o restante conta.
const MAX_PASSWORD_BYTES = 72;
const PASSWORD_TOO_LONG = 'A senha deve ter no máximo 72 caracteres.';
// `admin` e `gerente` só são atribuídos pela administração, nunca por quem
// se cadastra.
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
// R4 - 401 genérico tanto para senha errada quanto para e-mail sem conta,
//      com tempo de resposta equivalente (sem enumeração de contas).
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
    // Recusada antes de qualquer consulta: depois dela, conta existente e
    // inexistente gastariam tempos diferentes.
    if (normalizedPassword.length > MAX_VERIFIABLE_LENGTH) {
      throw new UnauthorizedException({ error: INVALID_CREDENTIALS });
    }

    // Senha trocada/redefinida depois deste instante invalida este login,
    // mesmo que a senha antiga já tenha sido conferida.
    let credentialCheckedAt = Date.now();
    const [user, [legacy = null]] = await Promise.all([
      this.usersService.findByEmail(normalizedEmail),
      findLegacyByEmail(this.prisma, normalizedEmail),
    ]);

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
        // A conta em `users` passou a ter a senha do WordPress: sessões
        // abertas com a senha anterior não podem sobreviver.
        if (user) {
          await this.sessionService.revokeAll(user.id);
          credentialCheckedAt = Date.now();
        }
      }
    }

    // R4
    if (!authenticatedUser) {
      // Só R1 com hash bcrypt gasta o tempo de um bcrypt; nos demais caminhos
      // (sem conta, só legado, hash WordPress em `users`) ele é simulado.
      if (!user?.passwordHash?.startsWith('$2')) {
        await this.passwordService.burnVerification(normalizedPassword);
      }
      throw new UnauthorizedException({ error: INVALID_CREDENTIALS });
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
    // Mesma regra da tela /equipe: só o titular ativo de um abrigo cria
    // acessos, e o acesso criado é sempre de abrigo.
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

    // O legado do WordPress que ainda não migrou também é dono do e-mail:
    // sem isto, quem cadastrasse o e-mail dele herdaria abrigo/voluntário.
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
    if (!normalizedEmail) return { ok: true };

    const user = await this.usersService.findByEmail(normalizedEmail);
    if (user) {
      await this.sendResetLink(user.email, user.id);
      return { ok: true };
    }

    // Legado WordPress que nunca logou ainda não tem conta em `users`; a
    // redefinição conclui a migração dele com a senha nova.
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

    // `new URL` absorve a barra final que o APP_URL pode ter no ambiente.
    const resetLink = new URL(
      '/redefinir-senha',
      this.config.get('APP_URL', { infer: true }),
    );
    resetLink.searchParams.set('token', token);
    // Sem await: esperar o SMTP só quando a conta existe revelava, pelo tempo
    // de resposta, quais e-mails estão cadastrados. Falhas de envio já são
    // tratadas e logadas pelo MailService.
    void this.mailService.sendPasswordReset(email, resetLink.toString());
  }

  // Doc 03 §10 / doc 05 §3.1. Uso único: a chave `pwdreset:{sha256(token)}`
  // é consumida na leitura (mesmo que a redefinição falhe depois, o usuário
  // pede outro link), os demais links pendentes do titular são invalidados e
  // `revokeAll` derruba todas as sessões existentes do usuário (login forçado
  // em qualquer dispositivo depois de uma troca de senha via recuperação).
  async resetPassword(token: string, password: string): Promise<{ ok: true }> {
    const normalizedPassword = (password ?? '').trim();
    if (normalizedPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException({ error: PASSWORD_TOO_SHORT });
    }
    assertPasswordFitsBcrypt(normalizedPassword);

    // GETDEL: com GET seguido de DEL, duas requisições simultâneas com o
    // mesmo link passavam ambas.
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

    return { ok: true };
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
    // O token de recuperação prova posse do e-mail, então o legado pendente
    // com o mesmo e-mail pode ser vinculado a esta conta.
    await this.legacyMigrationService.setPassword(userId, passwordHash, {
      claimLegacy: true,
    });
    return userId;
  }

  // Entre o pedido e o uso do link o usuário pode ter logado com a senha do
  // WordPress, o que já criou a conta; nesse caso só a senha muda.
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
      throw new BadRequestException({ error: PASSWORD_TOO_SHORT });
    }
    assertPasswordFitsBcrypt(normalizedNewPassword);

    const passwordHash = await this.passwordService.hash(normalizedNewPassword);
    // Saber a senha desta conta não prova posse do e-mail: o legado pendente
    // com o mesmo e-mail só pode ser assumido pela recuperação de senha.
    await this.legacyMigrationService.setPassword(
      (user as User).id,
      passwordHash,
      { claimLegacy: false },
    );
    await this.invalidateResetTokens(claims.sub);
    await this.sessionService.revokeAll(claims.sub, claims.sid);

    return { ok: true };
  }

  // Rehash de senha legada gravada em `users.passwordHash` (import parcial —
  // doc 03 §8). Falha de persistência não bloqueia o login, mas um hash
  // alterado por outra operação invalida esta tentativa de autenticação.
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
