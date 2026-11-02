import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user';
import type { Claims } from '../auth/jwt/token.service';
import { ChatMessagesService } from './chat-messages.service';
import { ChatModerationService } from './chat-moderation.service';
import { ChatThreadsService } from './chat-threads.service';

type ContentBody = { content?: unknown } | undefined;

@Controller('chat')
export class ChatController {
  constructor(
    private readonly threads: ChatThreadsService,
    private readonly messages: ChatMessagesService,
    private readonly moderation: ChatModerationService,
  ) {}

  @Get('threads')
  async listThreads(@CurrentUser() claims: Claims) {
    return { threads: await this.threads.listInbox(claims.sub) };
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() claims: Claims) {
    return { count: await this.threads.totalUnread(claims.sub) };
  }

  @Get('threads/:id/messages')
  listMessages(
    @CurrentUser() claims: Claims,
    @Param('id') threadId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.messages.list(
      claims.sub,
      threadId,
      cursor || undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('threads/:id/messages')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @CurrentUser() claims: Claims,
    @Param('id') threadId: string,
    @Body() body: ContentBody,
  ) {
    const message = await this.messages.send(
      claims.sub,
      threadId,
      body?.content,
    );
    return { message, success: true };
  }

  @Patch('threads/:id/messages/:messageId')
  async editMessage(
    @CurrentUser() claims: Claims,
    @Param('id') threadId: string,
    @Param('messageId') messageId: string,
    @Body() body: ContentBody,
  ) {
    const message = await this.messages.edit(
      claims.sub,
      threadId,
      messageId,
      body?.content,
    );
    return { message, success: true };
  }

  @Post('threads/:id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() claims: Claims, @Param('id') threadId: string) {
    const { unread_count } = await this.messages.markRead(claims.sub, threadId);
    return { success: true, unread_count };
  }

  @Post('blocks')
  @HttpCode(HttpStatus.OK)
  async block(@CurrentUser() claims: Claims, @Body() body: unknown) {
    await this.moderation.block(claims.sub, body);
    return { success: true };
  }

  @Post('reports')
  @HttpCode(HttpStatus.OK)
  async report(@CurrentUser() claims: Claims, @Body() body: unknown) {
    await this.moderation.report(claims.sub, body);
    return { success: true };
  }
}
