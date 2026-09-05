import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeRegisterType } from '../common/utils/register-type';
import { UserRole } from '../generated/prisma/enums';
import type { User } from '../generated/prisma/client';

const WP_ROLE_POST_TYPES: string[] = [UserRole.abrigo, UserRole.voluntario];

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<User | null> {
    const normalizedEmail = email.trim().toLowerCase();

    return this.prisma.user.findFirst({ where: { email: normalizedEmail } });
  }

  // Se `user.role` já estiver gravado, devolve sem tocar no banco. Caso
  // contrário replica o fallback do front (`postTypeResolver.ts`): busca em
  // `wp_posts_raw` pelo `post_author` (= `wpUserId`) o primeiro post do tipo
  // abrigo/voluntario publicado, mapeia para `UserRole` e persiste em
  // `users.role` antes de devolver.
  async resolveRole(user: User): Promise<UserRole | null> {
    if (user.role) return user.role;

    if (user.wpUserId == null) return null;

    const post = await this.prisma.wpPostRaw.findFirst({
      where: {
        postAuthor: BigInt(user.wpUserId),
        postType: { in: WP_ROLE_POST_TYPES },
        postStatus: 'publish',
      },
    });

    const resolved = normalizeRegisterType(post?.postType);
    if (!resolved) return null;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { role: resolved },
    });

    return resolved;
  }

  async findTeamUsers(creatorProfileId: string): Promise<User[]> {
    return this.prisma.user.findMany({
      where: { creatorProfileId, isTeamOnly: true },
    });
  }

  async setTeamDisabled(userId: string, disabled: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { teamDisabled: disabled },
    });
  }
}
