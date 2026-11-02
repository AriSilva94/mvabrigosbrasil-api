import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt/jwt.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatAccessService } from './chat-access.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatMessagesService } from './chat-messages.service';
import { ChatModerationService } from './chat-moderation.service';
import { ChatThreadsService } from './chat-threads.service';

@Module({
  imports: [JwtAuthModule, PrismaModule],
  controllers: [ChatController],
  providers: [
    ChatGateway,
    ChatAccessService,
    ChatThreadsService,
    ChatMessagesService,
    ChatModerationService,
  ],
  exports: [ChatGateway, ChatAccessService, ChatThreadsService],
})
export class ChatModule {}
