import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../redis/session.service';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async listUsers(creatorProfileId: string) {
    try {
      const rows = await this.prisma.user.findMany({
        where: { creatorProfileId, isTeamOnly: true },
        select: {
          id: true,
          email: true,
          createdAt: true,
          teamDisabled: true,
        },
      });

      return {
        users: rows.map((user) => ({
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
          isDisabled: user.teamDisabled,
        })),
      };
    } catch {
      throw new InternalServerErrorException(
        'Erro ao carregar usuários da equipe.',
      );
    }
  }

  async toggleUser(creatorProfileId: string, userId: string, disable: boolean) {
    let target: {
      isTeamOnly: boolean;
      creatorProfileId: string | null;
    } | null;
    try {
      target = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isTeamOnly: true, creatorProfileId: true },
      });
    } catch {
      throw new InternalServerErrorException(
        'Não foi possível alterar o status do usuário.',
      );
    }

    if (!target) {
      throw new NotFoundException('Usuário não encontrado.');
    }
    if (!target.isTeamOnly || target.creatorProfileId !== creatorProfileId) {
      throw new ForbiddenException('Acesso negado para alterar este usuário.');
    }

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { teamDisabled: disable },
      });
      if (disable) {
        await this.sessions.revokeAll(userId);
      }
      return { ok: true as const };
    } catch {
      throw new InternalServerErrorException(
        'Não foi possível alterar o status do usuário.',
      );
    }
  }
}
