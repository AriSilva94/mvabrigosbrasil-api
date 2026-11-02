import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  isForeignKeyViolation,
  isUniqueViolation,
} from '../common/utils/prisma-error';
import { PrismaService } from '../prisma/prisma.service';
import { blockSchema, reportSchema } from './schemas/chat.schema';

const invalid = () => new BadRequestException({ error: 'Dados inválidos' });

@Injectable()
export class ChatModerationService {
  constructor(private readonly prisma: PrismaService) {}

  async block(userId: string, input: unknown): Promise<void> {
    const parsed = blockSchema.safeParse(input);
    if (!parsed.success) throw invalid();
    if (parsed.data.blocked_id === userId) {
      throw new BadRequestException({ error: 'Não pode bloquear a si mesmo' });
    }

    try {
      await this.prisma.chatBlock.create({
        data: {
          blockerId: userId,
          blockedId: parsed.data.blocked_id,
          reason: parsed.data.reason,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({ error: 'Usuário já bloqueado' });
      }
      if (isForeignKeyViolation(error)) throw invalid();
      throw error;
    }
  }

  async report(userId: string, input: unknown): Promise<void> {
    const parsed = reportSchema.safeParse(input);
    if (!parsed.success) throw invalid();

    try {
      await this.prisma.chatReport.create({
        data: {
          reporterId: userId,
          reportedUserId: parsed.data.reported_user_id,
          reason: parsed.data.reason,
          threadId: parsed.data.thread_id,
          messageId: parsed.data.message_id,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({ error: 'Denúncia já registrada' });
      }
      if (isForeignKeyViolation(error)) throw invalid();
      throw error;
    }
  }
}
