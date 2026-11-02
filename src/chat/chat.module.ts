import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../auth/jwt/jwt.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [JwtAuthModule],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class ChatModule {}
