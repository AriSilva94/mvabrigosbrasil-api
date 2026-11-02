import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password/password.service';
import { normalizeRegisterType } from '../common/utils/register-type';
import { findLegacyByEmail } from './legacy/legacy-email';
import { UserRole } from '../generated/prisma/enums';
import type { Prisma, User, WpUserLegacy } from '../generated/prisma/client';

const WP_ROLE_POST_TYPES: string[] = [UserRole.abrigo, UserRole.voluntario];

type TxClient = Prisma.TransactionClient;

// Migração lazy do usuário legado WordPress no primeiro login bem-sucedido
// (doc 03 §6). Tudo roda numa única transação Prisma: uma migração parcial
// não pode existir — ou o usuário sai com senha nova + vínculos WP + flag
// `migrated`, ou nada muda.
@Injectable()
export class LegacyMigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async migrate(
    legacy: WpUserLegacy,
    plainPassword: string,
    existingUser?: User | null,
  ): Promise<User> {
    const userId = existingUser?.id ?? randomUUID();
    // bcrypt é custoso de propósito (custo configurável); calculamos fora da
    // transação para não segurar a conexão/lock do Postgres durante o hash.
    const passwordHash = await this.passwordService.hash(plainPassword);
    const wpUserId = Number(legacy.id);
    const email = (legacy.userEmail ?? existingUser?.email ?? '').toLowerCase();
    const fullName = existingUser?.fullName ?? legacy.displayName ?? null;
    const origin = existingUser?.origin ?? 'wordpress_migrated';
    const isTeamOnly = existingUser?.isTeamOnly ?? false;

    return this.prisma.$transaction(async (tx) => {
      // O estado lido antes de validar a senha pode ter mudado durante o
      // bcrypt. O UPDATE condicional serializa login legado e troca de senha.
      const claimed = await tx.wpUserLegacy.updateMany({
        where: { id: legacy.id, migrated: false },
        data: { migrated: true, migratedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException({ error: 'Senha inválida' });
      }
      const role =
        existingUser?.role ?? (await this.resolveRoleFromWp(tx, legacy.id));

      const data = {
        email,
        passwordHash,
        fullName,
        wpUserId,
        origin,
        emailVerified: true,
        isTeamOnly,
        role,
      };

      const user = await tx.user.upsert({
        where: { id: userId },
        create: { id: userId, ...data },
        update: data,
      });

      await this.linkUserPosts(tx, legacy.id, userId);

      return user;
    });
  }

  async setPassword(
    userId: string,
    passwordHash: string,
    options: { claimLegacy: boolean },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const pending = options.claimLegacy
        ? await findLegacyByEmail(tx, user.email, { pendingOnly: true })
        : [];

      // Adquire os locks do legado antes do usuário, na mesma ordem usada
      // pelo login lazy. Os vínculos são concluídos junto com a senha nova.
      for (const legacy of pending) {
        const claimed = await tx.wpUserLegacy.updateMany({
          where: { id: legacy.id, migrated: false },
          data: { migrated: true, migratedAt: new Date() },
        });
        if (claimed.count === 1) {
          await this.linkUserPosts(tx, legacy.id, userId);
        }
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          ...(pending.length > 0 && {
            wpUserId: user.wpUserId ?? Number(pending[0].id),
            role:
              user.role ?? (await this.resolveRoleFromWp(tx, pending[0].id)),
          }),
        },
      });
    });
  }

  private async linkUserPosts(
    tx: TxClient,
    legacyId: bigint,
    userId: string,
  ): Promise<void> {
    await this.linkPost(tx, legacyId, 'voluntario', async (wpPostId) => {
      await tx.volunteer.updateMany({
        where: { wpPostId, ownerProfileId: null },
        data: { ownerProfileId: userId },
      });
    });

    await this.linkPost(tx, legacyId, 'abrigo', async (wpPostId) => {
      await tx.shelter.updateMany({
        where: { wpPostId, profileId: null },
        data: { profileId: userId },
      });
    });
  }

  // wp_posts_raw filtrado por post_type/post_author, LIMIT 1 (via findFirst) —
  // igual ao SELECT das subqueries do doc 03 §6, passos 3 e 4.
  private async linkPost(
    tx: TxClient,
    wpAuthorId: bigint,
    postType: 'voluntario' | 'abrigo',
    apply: (wpPostId: number) => Promise<void>,
  ): Promise<void> {
    const post = await tx.wpPostRaw.findFirst({
      where: { postType, postAuthor: wpAuthorId },
    });
    if (!post) return;

    await apply(Number(post.id));
  }

  // Espelha `UsersService.resolveRole`, mas a partir do wp_user_id legado em
  // vez de um `User` já persistido (doc 03 §9).
  private async resolveRoleFromWp(
    tx: TxClient,
    wpAuthorId: bigint,
  ): Promise<UserRole | null> {
    const post = await tx.wpPostRaw.findFirst({
      where: {
        postAuthor: wpAuthorId,
        postType: { in: WP_ROLE_POST_TYPES },
        postStatus: 'publish',
      },
    });

    return normalizeRegisterType(post?.postType);
  }
}
