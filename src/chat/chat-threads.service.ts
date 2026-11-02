import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const INBOX_LIMIT = 50;

export type LastMessageDto = {
  content: string;
  sender_id: string;
  created_at: string;
  message_type: string;
};

export type ThreadWithMetaDto = {
  id: string;
  status: string;
  updated_at: string;
  volunteer_profile_id: string;
  shelter_profile_id: string;
  vacancy_title: string;
  vacancy_slug: string | null;
  other_participant_name: string;
  last_message: LastMessageDto | null;
  unread_count: number;
};

type InboxRow = {
  id: string;
  status: string;
  updatedAt: Date;
  volunteerProfileId: string;
  shelterProfileId: string;
  vacancy: { title: string; slug: string | null };
  shelter: { name: string };
  volunteer: { name: string };
};

export function toInboxThread(
  row: InboxRow,
  userId: string,
  lastMessage: LastMessageDto | null,
  unreadCount: number,
): ThreadWithMetaDto {
  const isVolunteer = row.volunteerProfileId === userId;
  return {
    id: row.id,
    status: row.status,
    updated_at: row.updatedAt.toISOString(),
    volunteer_profile_id: row.volunteerProfileId,
    shelter_profile_id: row.shelterProfileId,
    vacancy_title: row.vacancy.title || 'Vaga',
    vacancy_slug: row.vacancy.slug || null,
    other_participant_name: isVolunteer
      ? row.shelter.name || 'Abrigo'
      : row.volunteer.name || 'Voluntário',
    last_message: lastMessage,
    unread_count: unreadCount,
  };
}

@Injectable()
export class ChatThreadsService {
  constructor(private readonly prisma: PrismaService) {}

  async listInbox(userId: string): Promise<ThreadWithMetaDto[]> {
    const rows = await this.prisma.chatThread.findMany({
      where: {
        status: 'active',
        OR: [{ volunteerProfileId: userId }, { shelterProfileId: userId }],
      },
      orderBy: { updatedAt: 'desc' },
      take: INBOX_LIMIT,
      select: {
        id: true,
        status: true,
        updatedAt: true,
        volunteerProfileId: true,
        shelterProfileId: true,
        vacancy: { select: { title: true, slug: true } },
        shelter: { select: { name: true } },
        volunteer: { select: { name: true } },
      },
    });
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const [lastMessages, unread] = await Promise.all([
      this.lastMessages(ids),
      this.unreadByThread(userId, ids),
    ]);

    return rows.map((row) =>
      toInboxThread(
        row,
        userId,
        lastMessages.get(row.id) ?? null,
        unread.get(row.id) ?? 0,
      ),
    );
  }

  async totalUnread(userId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM chat_messages m
      JOIN chat_participants p ON p.thread_id = m.thread_id AND p.profile_id = ${userId}::uuid
      JOIN chat_threads t ON t.id = m.thread_id
      WHERE t.status = 'active' AND p.is_active
        AND m.created_at > p.last_read_at
        AND m.sender_id <> ${userId}::uuid
        AND m.deleted_at IS NULL`;
    return row?.count ?? 0;
  }

  private async lastMessages(
    threadIds: string[],
  ): Promise<Map<string, LastMessageDto>> {
    const rows = await this.prisma.$queryRaw<
      {
        thread_id: string;
        content: string;
        sender_id: string;
        created_at: Date;
        message_type: string;
      }[]
    >`
      SELECT DISTINCT ON (thread_id) thread_id, content, sender_id, created_at, message_type
      FROM chat_messages
      WHERE thread_id = ANY(${threadIds}::uuid[]) AND deleted_at IS NULL
      ORDER BY thread_id, created_at DESC, id DESC`;
    return new Map(
      rows.map((row) => [
        row.thread_id,
        {
          content: row.content,
          sender_id: row.sender_id,
          created_at: row.created_at.toISOString(),
          message_type: row.message_type,
        },
      ]),
    );
  }

  private async unreadByThread(
    userId: string,
    threadIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<
      { thread_id: string; count: number }[]
    >`
      SELECT m.thread_id, count(*)::int AS count
      FROM chat_messages m
      JOIN chat_participants p ON p.thread_id = m.thread_id AND p.profile_id = ${userId}::uuid
      WHERE m.thread_id = ANY(${threadIds}::uuid[])
        AND m.created_at > p.last_read_at
        AND m.sender_id <> ${userId}::uuid
        AND m.deleted_at IS NULL
      GROUP BY m.thread_id`;
    return new Map(rows.map((row) => [row.thread_id, row.count]));
  }
}
