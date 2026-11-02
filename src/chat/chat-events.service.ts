import { Injectable } from '@nestjs/common';
import { ChatGateway, userRoom } from './chat.gateway';
import type { MessageDto } from './chat-messages.service';

// Eventos vão sempre para as salas dos participantes, nunca para uma sala
// "da conversa" escolhida pelo client: quem não participa não tem como
// receber.
@Injectable()
export class ChatEventsService {
  constructor(private readonly gateway: ChatGateway) {}

  messageCreated(message: MessageDto, participantIds: string[]): void {
    this.emit(participantIds, 'chat:message', message);
  }

  messageUpdated(message: MessageDto, participantIds: string[]): void {
    this.emit(participantIds, 'chat:message-updated', message);
  }

  private emit(userIds: string[], event: string, payload: unknown): void {
    if (userIds.length === 0) return;
    this.gateway.server.to(userIds.map(userRoom)).emit(event, payload);
  }
}
