import { Injectable } from '@nestjs/common';
import { ChatGateway, userRoom } from './chat.gateway';
import type { MessageDto } from './chat-message.dto';
import { PresenceService } from './presence.service';

// Eventos vão sempre para as salas dos participantes, nunca para uma sala
// "da conversa" escolhida pelo client: quem não participa não tem como
// receber.
@Injectable()
export class ChatEventsService {
  constructor(
    private readonly gateway: ChatGateway,
    private readonly presence: PresenceService,
  ) {}

  messageCreated(message: MessageDto, participantIds: string[]): void {
    this.emit(participantIds, 'chat:message', message);
  }

  messageUpdated(message: MessageDto, participantIds: string[]): void {
    this.emit(participantIds, 'chat:message-updated', message);
  }

  // A presença só é enviada na conexão; quando uma conversa nova liga duas
  // pessoas já conectadas, cada uma precisa saber agora se a outra está online.
  async introduce(userA: string, userB: string): Promise<void> {
    const online = new Set(await this.presence.onlineAmong([userA, userB]));
    if (online.has(userA)) {
      this.emit([userB], 'chat:presence', { profileId: userA, online: true });
    }
    if (online.has(userB)) {
      this.emit([userA], 'chat:presence', { profileId: userB, online: true });
    }
  }

  private emit(userIds: string[], event: string, payload: unknown): void {
    if (userIds.length === 0) return;
    this.gateway.server.to(userIds.map(userRoom)).emit(event, payload);
  }
}
