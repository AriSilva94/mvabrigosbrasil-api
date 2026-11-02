import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  ConnectedSocket,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { parse } from 'cookie';
import type { Server, Socket } from 'socket.io';
import { TokenService, type Claims } from '../auth/jwt/token.service';
import type { Env } from '../config/env.validation';
import { ChatAccessService } from './chat-access.service';
import { PresenceService } from './presence.service';

// Fica sob /api/v1 para passar pela mesma regra de roteamento (Traefik,
// gateway local e rewrites do Next) e levar o cookie de sessão junto.
export const CHAT_SOCKET_PATH = '/api/v1/socket.io';

export const userRoom = (userId: string): string => `user:${userId}`;

type SocketData = { claims: Claims; expiryTimer?: NodeJS.Timeout };

// Sem barra final: o Next normaliza `/socket.io/` com redirect 308, o que
// quebraria o handshake ao passar pelos rewrites do `next dev`.
@WebSocketGateway({
  path: CHAT_SOCKET_PATH,
  addTrailingSlash: false,
  serveClient: false,
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly presence: PresenceService,
    private readonly access: ChatAccessService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  afterInit(server: Server): void {
    const appOrigin = new URL(this.config.get('APP_URL', { infer: true }))
      .origin;
    server.use((socket, next) => {
      // WebSocket não passa por CORS: sem esta checagem outro site poderia
      // abrir o socket com o cookie do usuário quando o navegador o envia.
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== appOrigin) {
        return next(new Error('forbidden origin'));
      }
      next();
    });
    server.use((socket, next) => {
      void this.authenticate(socket)
        .then((claims) => {
          if (!claims) return next(new Error('unauthorized'));
          (socket.data as SocketData).claims = claims;
          next();
        })
        .catch((error: unknown) => {
          this.logger.error('Falha ao autenticar socket', error);
          next(new Error('unauthorized'));
        });
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const data = socket.data as SocketData;
    const userId = data.claims.sub;
    await socket.join(userRoom(userId));
    this.scheduleExpiry(socket, data);

    try {
      const [cameOnline, contacts] = await Promise.all([
        this.presence.connect(userId),
        this.access.counterpartIds(userId),
      ]);
      if (cameOnline) this.emitPresence(userId, true, contacts);
      socket.emit('chat:presence-snapshot', {
        online: await this.presence.onlineAmong(contacts),
      });
    } catch (error) {
      this.logger.error('Falha ao registrar presença', error);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const data = socket.data as Partial<SocketData>;
    clearTimeout(data.expiryTimer);
    if (!data.claims) return;

    const userId = data.claims.sub;
    try {
      if (await this.presence.disconnect(userId)) {
        this.emitPresence(
          userId,
          false,
          await this.access.counterpartIds(userId),
        );
      }
    } catch (error) {
      this.logger.error('Falha ao remover presença', error);
    }
  }

  @SubscribeMessage('chat:heartbeat')
  async heartbeat(@ConnectedSocket() socket: Socket): Promise<void> {
    await this.presence.heartbeat((socket.data as SocketData).claims.sub);
  }

  private emitPresence(
    userId: string,
    online: boolean,
    contacts: string[],
  ): void {
    if (contacts.length === 0) return;
    this.server
      .to(contacts.map(userRoom))
      .emit('chat:presence', { profileId: userId, online });
  }

  private async authenticate(socket: Socket): Promise<Claims | null> {
    const token = parse(socket.handshake.headers.cookie ?? '').mv_at;
    return token ? this.tokens.verify(token) : null;
  }

  // Socket não pode sobreviver ao access token: sessão revogada ou papel
  // alterado só são refletidos quando o client reconecta com token novo.
  private scheduleExpiry(socket: Socket, data: SocketData): void {
    const exp = (data.claims as Claims & { exp?: number }).exp;
    if (!exp) return;
    const delay = Math.max(exp * 1000 - Date.now(), 0);
    data.expiryTimer = setTimeout(() => socket.disconnect(true), delay);
  }
}
