import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
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
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  authCookie,
  cleanupChatPeople,
  createThread,
  seedChatPeople,
  type ChatPeople,
} from './helpers/chat-fixtures';
import {
  registerTestSession,
  tokensWithSessions,
} from './helpers/active-session';

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

function expectSilence(socket: Socket, event: string, ms = 600): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`unexpected ${event}`));
    socket.on(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, ms);
  });
}

describe('Chat socket gateway (e2e)', () => {
  let app: INestApplication<App>;
  let url: string;
  let tokens: TokenService;
  let jwt: JwtService;
  let config: ConfigService;
  let prisma: PrismaService;
  const seeded: ChatPeople[] = [];
  const sockets: Socket[] = [];

  const connect = (token?: string, origin?: string): Socket => {
    const socket = io(url, {
      path: CHAT_SOCKET_PATH,
      addTrailingSlash: false,
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: {
        ...(token ? { cookie: `mv_at=${token}` } : {}),
        ...(origin ? { origin } : {}),
      },
    });
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis();
    app.useWebSocketAdapter(adapter);
    await app.listen(0);
    url = await app.getUrl();
    tokens = tokensWithSessions(app);
    jwt = app.get(JwtService);
    config = app.get(ConfigService);
    prisma = app.get(PrismaService);
  });

  afterEach(() => {
    sockets.splice(0).forEach((socket) => socket.disconnect());
  });

  afterAll(async () => {
    for (const people of seeded) await cleanupChatPeople(prisma, people);
    await app.close();
  });

  it('rejects a connection without mv_at', async () => {
    const error = await waitFor<Error>(connect(), 'connect_error');
    expect(error.message).toBe('unauthorized');
  });

  it('rejects a browser handshake from another origin', async () => {
    const token = await tokens.sign(claims(randomUUID()));
    const error = await waitFor<Error>(
      connect(token, 'https://evil.example'),
      'connect_error',
    );
    expect(error.message).toBe('forbidden origin');
  });

  it('accepts a browser handshake from APP_URL', async () => {
    const token = await tokens.sign(claims(randomUUID()));
    const appOrigin = new URL(config.getOrThrow<string>('APP_URL')).origin;
    await waitFor(connect(token, appOrigin), 'connect');
  });

  it('accepts mv_at cookie and joins the user room', async () => {
    const userA = randomUUID();
    const socket = connect(await tokens.sign(claims(userA)));
    await waitFor(socket, 'connect');

    const received = waitFor<number>(socket, 'ping-test');
    app.get(ChatGateway).server.to(userRoom(userA)).emit('ping-test', 1);

    await expect(received).resolves.toBe(1);
  });

  it('disconnects when the access token expires', async () => {
    const shortLivedClaims = claims(randomUUID());
    await registerTestSession(app, shortLivedClaims);
    const shortLived = await jwt.signAsync(shortLivedClaims, {
      secret: config.getOrThrow<string>('AUTH_JWT_SECRET'),
      expiresIn: '1s',
      algorithm: 'HS256',
    });
    const socket = connect(shortLived);
    await waitFor(socket, 'connect');

    const reason = await waitFor<string>(socket, 'disconnect', 4000);
    expect(reason).toBe('io server disconnect');
  });

  describe('realtime events and presence', () => {
    let people: ChatPeople;
    let threadId: string;
    const http = () => request(app.getHttpServer());

    const connected = async (token: string): Promise<Socket> => {
      const socket = connect(token);
      await waitFor(socket, 'connect');
      return socket;
    };

    beforeEach(async () => {
      people = await seedChatPeople(
        prisma,
        tokens,
        `rt-${randomUUID().slice(0, 6)}`,
      );
      seeded.push(people);
      threadId = await createThread(prisma, people);
    });

    it('delivers chat:message to both participants and not to a third user', async () => {
      const volunteer = await connected(people.volunteerUser.token);
      const shelter = await connected(people.shelterOwner.token);
      const outsider = await connected(people.outsider.token);
      const toVolunteer = waitFor<{ content: string }>(
        volunteer,
        'chat:message',
      );
      const toShelter = waitFor<{ content: string; thread_id: string }>(
        shelter,
        'chat:message',
      );
      const silence = expectSilence(outsider, 'chat:message');

      await http()
        .post(`/api/v1/chat/threads/${threadId}/messages`)
        .set('Cookie', authCookie(people.volunteerUser.token))
        .send({ content: 'olá abrigo' })
        .expect(200);

      await expect(toVolunteer).resolves.toMatchObject({
        content: 'olá abrigo',
      });
      await expect(toShelter).resolves.toMatchObject({
        content: 'olá abrigo',
        thread_id: threadId,
      });
      await silence;
    });

    it('edit and read emit chat:message-updated to both participants', async () => {
      const sent = await http()
        .post(`/api/v1/chat/threads/${threadId}/messages`)
        .set('Cookie', authCookie(people.volunteerUser.token))
        .send({ content: 'original' })
        .expect(200);
      const messageId = (sent.body as { message: { id: string } }).message.id;
      const volunteer = await connected(people.volunteerUser.token);
      const shelter = await connected(people.shelterOwner.token);

      const edited = Promise.all([
        waitFor<{ content: string }>(volunteer, 'chat:message-updated'),
        waitFor<{ content: string }>(shelter, 'chat:message-updated'),
      ]);
      await http()
        .patch(`/api/v1/chat/threads/${threadId}/messages/${messageId}`)
        .set('Cookie', authCookie(people.volunteerUser.token))
        .send({ content: 'editada' })
        .expect(200);
      for (const payload of await edited)
        expect(payload.content).toBe('editada');

      const read = waitFor<{ id: string; status: string }>(
        volunteer,
        'chat:message-updated',
      );
      await http()
        .post(`/api/v1/chat/threads/${threadId}/read`)
        .set('Cookie', authCookie(people.shelterOwner.token))
        .expect(200);
      await expect(read).resolves.toMatchObject({
        id: messageId,
        status: 'read',
      });
    });

    it('presence: B sees A online/offline only if they share a thread; C never receives A presence', async () => {
      const shelter = await connected(people.shelterOwner.token);
      const outsider = await connected(people.outsider.token);
      const silence = expectSilence(outsider, 'chat:presence', 1500);

      const online = waitFor<{ profileId: string; online: boolean }>(
        shelter,
        'chat:presence',
      );
      const volunteer = await connected(people.volunteerUser.token);
      await expect(online).resolves.toEqual({
        profileId: people.volunteerUser.id,
        online: true,
      });

      const offline = waitFor<{ profileId: string; online: boolean }>(
        shelter,
        'chat:presence',
      );
      volunteer.disconnect();
      await expect(offline).resolves.toEqual({
        profileId: people.volunteerUser.id,
        online: false,
      });
      await silence;
    });

    it('two tabs of A: closing one keeps A online', async () => {
      const tab1 = await connected(people.volunteerUser.token);
      await connected(people.volunteerUser.token);
      const shelter = connect(people.shelterOwner.token);
      const snapshot = waitFor<{ online: string[] }>(
        shelter,
        'chat:presence-snapshot',
      );
      await expect(snapshot).resolves.toEqual({
        online: [people.volunteerUser.id],
      });

      const silence = expectSilence(shelter, 'chat:presence');
      tab1.disconnect();
      await silence;
    });

    it('a new conversation shares presence between participants already online', async () => {
      const fresh = await seedChatPeople(
        prisma,
        tokens,
        `intro-${randomUUID().slice(0, 6)}`,
      );
      seeded.push(fresh);
      const volunteer = await connected(fresh.volunteerUser.token);
      const shelter = await connected(fresh.shelterOwner.token);
      const shelterSeesVolunteer = waitFor<{
        profileId: string;
        online: boolean;
      }>(shelter, 'chat:presence');
      const volunteerSeesShelter = waitFor<{
        profileId: string;
        online: boolean;
      }>(volunteer, 'chat:presence');

      await http()
        .post(`/api/v1/vacancies/${fresh.vacancyId}/apply`)
        .set('Cookie', authCookie(fresh.volunteerUser.token))
        .expect(200);

      await expect(shelterSeesVolunteer).resolves.toEqual({
        profileId: fresh.volunteerUser.id,
        online: true,
      });
      await expect(volunteerSeesShelter).resolves.toEqual({
        profileId: fresh.shelterOwner.id,
        online: true,
      });
    });
  });
});
