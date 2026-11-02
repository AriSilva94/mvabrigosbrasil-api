import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toMessageDto, type MessageDto } from './chat-message.dto';

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

export type ApplicationThreadInput = {
  vacancyId: string;
  vacancyTitle: string;
  shelterId: string;
  shelterProfileId: string;
  volunteerId: string;
  volunteerProfileId: string;
  applicationId: string;
};

export const applicationSystemMessage = (vacancyTitle: string): string =>
  `Candidatura enviada para a vaga "${vacancyTitle}". Vocês já podem trocar mensagens!`;

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

  // Roda dentro da transação da candidatura: qualquer falha aqui desfaz a
  // candidatura junto. Idempotente pelo UNIQUE (vaga, voluntário).
  async createForApplication(
    tx: Prisma.TransactionClient,
    input: ApplicationThreadInput,
  ): Promise<{ threadId: string; systemMessage: MessageDto | null }> {
    const existing = await tx.chatThread.findUnique({
      where: {
        vacancyId_volunteerProfileId: {
          vacancyId: input.vacancyId,
          volunteerProfileId: input.volunteerProfileId,
        },
      },
      select: { id: true },
    });
    const thread =
      existing ??
      (await tx.chatThread.create({
        data: {
          vacancyId: input.vacancyId,
          volunteerProfileId: input.volunteerProfileId,
          shelterProfileId: input.shelterProfileId,
          shelterId: input.shelterId,
          volunteerId: input.volunteerId,
          applicationId: input.applicationId,
        },
        select: { id: true },
      }));

    await tx.chatParticipant.createMany({
      data: [
        {
          threadId: thread.id,
          profileId: input.volunteerProfileId,
          role: 'volunteer',
        },
        {
          threadId: thread.id,
          profileId: input.shelterProfileId,
          role: 'shelter',
        },
      ],
      skipDuplicates: true,
    });
    if (existing) return { threadId: thread.id, systemMessage: null };

    const message = await tx.chatMessage.create({
      data: {
        threadId: thread.id,
        senderId: input.volunteerProfileId,
        content: applicationSystemMessage(input.vacancyTitle),
        messageType: 'system',
      },
    });
    await tx.chatThread.update({
      where: { id: thread.id },
      data: { updatedAt: message.createdAt },
    });
    return { threadId: thread.id, systemMessage: toMessageDto(message) };
  }

  async threadIdsByVacancy(userId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.chatThread.findMany({
      where: { volunteerProfileId: userId, status: 'active' },
      select: { id: true, vacancyId: true },
    });
    return Object.fromEntries(rows.map((row) => [row.vacancyId, row.id]));
  }

  // Conversa mais recente do abrigo com o voluntário do perfil público; só
  // existe depois de uma candidatura a vaga do abrigo.
  async threadIdWithVolunteer(
    shelterProfileId: string,
    volunteerSlug: string,
  ): Promise<string | null> {
    const thread = await this.prisma.chatThread.findFirst({
      where: {
        shelterProfileId,
        status: 'active',
        volunteer: { slug: volunteerSlug },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    return thread?.id ?? null;
  }

  async threadIdsByVolunteer(vacancyId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.chatThread.findMany({
      where: { vacancyId },
      select: { id: true, volunteerId: true },
    });
    return new Map(rows.map((row) => [row.volunteerId, row.id]));
  }

  async findForApplicant(
    vacancyId: string,
    volunteerProfileId: string,
  ): Promise<{ id: string; shelterProfileId: string } | null> {
    return this.prisma.chatThread.findUnique({
      where: {
        vacancyId_volunteerProfileId: { vacancyId, volunteerProfileId },
      },
      select: { id: true, shelterProfileId: true },
    });
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
