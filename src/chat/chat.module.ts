import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt/jwt.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatAccessService } from './chat-access.service';
import { ChatController } from './chat.controller';
import { ChatEventsService } from './chat-events.service';
import { ChatGateway } from './chat.gateway';
import { ChatMessagesService } from './chat-messages.service';
import { ChatModerationService } from './chat-moderation.service';
import { ChatThreadsService } from './chat-threads.service';
import { PresenceService } from './presence.service';

@Module({
  imports: [JwtAuthModule, PrismaModule],
  controllers: [ChatController],
  providers: [
    ChatGateway,
    ChatAccessService,
    ChatThreadsService,
    ChatMessagesService,
    ChatModerationService,
    ChatEventsService,
    PresenceService,
  ],
  exports: [ChatEventsService, ChatThreadsService],
})
export class ChatModule {}
