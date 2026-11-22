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
    const passwordHash = await this.passwordService.hash(plainPassword);
    const wpUserId = Number(legacy.id);
    const email = (legacy.userEmail ?? existingUser?.email ?? '').toLowerCase();
    const fullName = existingUser?.fullName ?? legacy.displayName ?? null;
    const origin = existingUser?.origin ?? 'wordpress_migrated';
    const isTeamOnly = existingUser?.isTeamOnly ?? false;

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.wpUserLegacy.updateMany({
        where: { id: legacy.id, migrated: false },
        data: { migrated: true, migratedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException({
          error: 'E-mail ou senha inválidos.',
        });
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
          ...(options.claimLegacy && { emailVerified: true }),
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
