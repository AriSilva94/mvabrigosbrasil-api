import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatThread } from '../generated/prisma/client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ChatAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async requireParticipant(
    threadId: string,
    userId: string,
  ): Promise<ChatThread> {
    const thread = UUID_RE.test(threadId)
      ? await this.prisma.chatThread.findUnique({
          where: { id: threadId },
          include: {
            participants: {
              where: { profileId: userId, isActive: true },
              select: { id: true },
            },
          },
        })
      : null;
    if (!thread) {
      throw new NotFoundException({ error: 'Conversa não encontrada' });
    }
    if (thread.participants.length === 0) {
      throw new ForbiddenException({ error: 'Acesso negado' });
    }
    const { participants: _participants, ...rest } = thread;
    return rest;
  }

  async isBlocked(a: string, b: string): Promise<boolean> {
    const count = await this.prisma.chatBlock.count({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });
    return count > 0;
  }

  async counterpartIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.chatParticipant.findMany({
      where: {
        profileId: { not: userId },
        thread: { participants: { some: { profileId: userId } } },
      },
      select: { profileId: true },
      distinct: ['profileId'],
    });
    return rows.map((row) => row.profileId);
  }
}
