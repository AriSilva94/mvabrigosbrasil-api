import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user';
import type { Claims } from '../auth/jwt/token.service';
import { ChatThreadsService } from './chat-threads.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly threads: ChatThreadsService) {}

  @Get('threads')
  async listThreads(@CurrentUser() claims: Claims) {
    return { threads: await this.threads.listInbox(claims.sub) };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() claims: Claims) {
    return { count: await this.threads.totalUnread(claims.sub) };
  }
}
