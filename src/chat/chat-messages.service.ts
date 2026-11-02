import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatMessage, Prisma } from '../generated/prisma/client';
import { ChatAccessService } from './chat-access.service';
import { ChatThreadsService } from './chat-threads.service';
import { messageContentSchema } from './schemas/chat.schema';

const PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;
const RATE_LIMIT_PER_MINUTE = 30;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MessageDto = {
  id: string;
  thread_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  status: string;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MessagePage = {
  messages: MessageDto[];
  has_more: boolean;
  next_cursor: string | null;
};

export function toMessageDto(message: ChatMessage): MessageDto {
  return {
    id: message.id,
    thread_id: message.threadId,
    sender_id: message.senderId,
    content: message.content,
    message_type: message.messageType,
    status: message.status,
    edited_at: message.editedAt?.toISOString() ?? null,
    deleted_at: message.deletedAt?.toISOString() ?? null,
    created_at: message.createdAt.toISOString(),
    updated_at: message.updatedAt.toISOString(),
  };
}

function parseContent(input: unknown): string {
  const parsed = messageContentSchema.safeParse({ content: input });
  if (!parsed.success) {
    throw new BadRequestException({ error: 'Mensagem inválida' });
  }
  return parsed.data.content;
}

function parseCursor(cursor: string): Prisma.ChatMessageWhereInput {
  const separator = cursor.indexOf('|');
  const createdAt = new Date(
    separator === -1 ? cursor : cursor.slice(0, separator),
  );
  const id = separator === -1 ? null : cursor.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || (id !== null && !UUID_RE.test(id))) {
    throw new BadRequestException({ error: 'Cursor inválido' });
  }
  return id === null
    ? { createdAt: { lt: createdAt } }
    : {
        OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
      };
}

@Injectable()
export class ChatMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ChatAccessService,
    private readonly threads: ChatThreadsService,
  ) {}

  async list(
    userId: string,
    threadId: string,
    cursor?: string,
    limit?: number,
  ): Promise<MessagePage> {
    await this.access.requireParticipant(threadId, userId);
    const take = Math.min(
      Math.max(Number.isFinite(limit) ? Number(limit) : PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );

    const rows = await this.prisma.chatMessage.findMany({
      where: {
        threadId,
        deletedAt: null,
        ...(cursor ? parseCursor(cursor) : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = rows.slice(0, take).reverse().map(toMessageDto);
    const oldest = page[0];
    return {
      messages: page,
      has_more: hasMore,
      next_cursor:
        hasMore && oldest ? `${oldest.created_at}|${oldest.id}` : null,
    };
  }

  async send(
    userId: string,
    threadId: string,
    input: unknown,
  ): Promise<MessageDto> {
    const content = parseContent(input);
    const thread = await this.access.requireParticipant(threadId, userId);
    if (thread.status !== 'active') {
      throw new BadRequestException({ error: 'Conversa encerrada' });
    }
    const otherId =
      thread.volunteerProfileId === userId
        ? thread.shelterProfileId
        : thread.volunteerProfileId;
    if (await this.access.isBlocked(userId, otherId)) {
      throw new ForbiddenException({
        error: 'Não é possível enviar mensagem nesta conversa',
      });
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const recent = await tx.chatMessage.count({
        where: {
          threadId,
          senderId: userId,
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
      });
      if (recent >= RATE_LIMIT_PER_MINUTE) {
        throw new HttpException(
          { error: 'Limite de mensagens atingido. Aguarde um momento.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const created = await tx.chatMessage.create({
        data: { threadId, senderId: userId, content, messageType: 'text' },
      });
      await tx.chatThread.update({
        where: { id: threadId },
        data: { updatedAt: created.createdAt },
      });
      return created;
    });

    return toMessageDto(message);
  }

  async edit(
    userId: string,
    threadId: string,
    messageId: string,
    input: unknown,
  ): Promise<MessageDto> {
    const content = parseContent(input);
    await this.access.requireParticipant(threadId, userId);
    const message = UUID_RE.test(messageId)
      ? await this.prisma.chatMessage.findFirst({
          where: { id: messageId, threadId },
        })
      : null;
    if (!message) {
      throw new NotFoundException({ error: 'Mensagem não encontrada' });
    }
    if (message.senderId !== userId) {
      throw new ForbiddenException({ error: 'Acesso negado' });
    }
    if (message.deletedAt) {
      throw new BadRequestException({ error: 'Mensagem já foi deletada' });
    }
    if (message.messageType !== 'text') {
      throw new BadRequestException({
        error: 'Não é possível editar esta mensagem',
      });
    }
    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new BadRequestException({
        error: 'O tempo para editar esta mensagem expirou',
      });
    }

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
    });
    return toMessageDto(updated);
  }

  async markRead(
    userId: string,
    threadId: string,
  ): Promise<{ unread_count: number; updated: MessageDto[] }> {
    await this.access.requireParticipant(threadId, userId);
    const latest = await this.prisma.chatMessage.findFirst({
      where: { threadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    // Mensagem com relógio adiantado não pode continuar como não lida.
    const now = new Date();
    const readAt = latest && latest.createdAt > now ? latest.createdAt : now;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.chatParticipant.updateMany({
        where: { threadId, profileId: userId },
        data: { lastReadAt: readAt },
      });
      return tx.chatMessage.updateManyAndReturn({
        where: {
          threadId,
          senderId: { not: userId },
          status: 'sent',
          deletedAt: null,
        },
        data: { status: 'read' },
      });
    });

    return {
      unread_count: await this.threads.totalUnread(userId),
      updated: updated.map(toMessageDto),
    };
  }
}
