import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { parse } from 'cookie';
import type { Server, Socket } from 'socket.io';
import { TokenService, type Claims } from '../auth/jwt/token.service';

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

  constructor(private readonly tokens: TokenService) {}

  afterInit(server: Server): void {
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
    await socket.join(userRoom(data.claims.sub));
    this.scheduleExpiry(socket, data);
  }

  handleDisconnect(socket: Socket): void {
    clearTimeout((socket.data as SocketData).expiryTimer);
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
