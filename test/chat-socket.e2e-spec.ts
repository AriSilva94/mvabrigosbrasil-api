import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from './../src/app.module';
import { TokenService, type Claims } from './../src/auth/jwt/token.service';
import {
  CHAT_SOCKET_PATH,
  ChatGateway,
  userRoom,
} from './../src/chat/chat.gateway';
import { RedisIoAdapter } from './../src/chat/redis-io.adapter';

const claims = (sub: string): Claims => ({
  sub,
  email: `${sub}@test.local`,
  role: 'voluntario',
  isTeamOnly: false,
  teamDisabled: false,
  creatorProfileId: null,
  sid: `sid-${sub}`,
});

function waitFor<T>(
  socket: Socket,
  event: string,
  timeoutMs = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${event}`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Chat socket gateway (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let tokens: TokenService;
  let jwt: JwtService;
  let config: ConfigService;
  const sockets: Socket[] = [];

  const connect = (token?: string): Socket => {
    const socket = io(url, {
      path: CHAT_SOCKET_PATH,
      addTrailingSlash: false,
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: token ? { cookie: `mv_at=${token}` } : {},
    });
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis();
    app.useWebSocketAdapter(adapter);
    await app.listen(0);
    url = await app.getUrl();
    tokens = app.get(TokenService);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a connection without mv_at', async () => {
    const error = await waitFor<Error>(connect(), 'connect_error');
    expect(error.message).toBe('unauthorized');
  });

  it('accepts mv_at cookie and joins the user room', async () => {
    const socket = connect(await tokens.sign(claims('user-a')));
    await waitFor(socket, 'connect');

    const received = waitFor<number>(socket, 'ping-test');
    app.get(ChatGateway).server.to(userRoom('user-a')).emit('ping-test', 1);

    await expect(received).resolves.toBe(1);
  });

  it('disconnects when the access token expires', async () => {
    const shortLived = await jwt.signAsync(claims('user-b'), {
      secret: config.getOrThrow<string>('AUTH_JWT_SECRET'),
      expiresIn: '1s',
      algorithm: 'HS256',
    });
    const socket = connect(shortLived);
    await waitFor(socket, 'connect');

    const reason = await waitFor<string>(socket, 'disconnect', 4000);
    expect(reason).toBe('io server disconnect');
  });
});
