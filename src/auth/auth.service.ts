import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { PasswordService } from './password/password.service';
import { LegacyMigrationService } from './legacy-migration.service';
import { SessionService } from '../redis/session.service';
import { TokenService, Claims } from './jwt/token.service';
import { PrismaService } from '../prisma/prisma.service';
import type { User } from '../generated/prisma/client';

export type LoginResult = {
  userId: string;
  role: Claims['role'];
  migrated: boolean;
  at: string;
  rt: string;
  sid: string;
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
