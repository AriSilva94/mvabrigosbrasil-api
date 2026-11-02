import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { TokenService } from './../src/auth/jwt/token.service';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import {
  authCookie,
  cleanupChatPeople,
  createThread,
  seedChatPeople,
  type ChatPeople,
} from './helpers/chat-fixtures';

type InboxThread = {
  id: string;
  status: string;
  updated_at: string;
  volunteer_profile_id: string;
  shelter_profile_id: string;
  vacancy_title: string;
  vacancy_slug: string | null;
  other_participant_name: string;
  last_message: {
    content: string;
    sender_id: string;
    created_at: string;
    message_type: string;
  } | null;
  unread_count: number;
};

describe('Chat REST (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const seeded: ChatPeople[] = [];

  const seed = async (label: string) => {
    const people = await seedChatPeople(prisma, tokens, label);
    seeded.push(people);
    return people;
  };

  const message = (
    threadId: string,
    senderId: string,
    createdAt: Date,
    extra: { content?: string; messageType?: string; deletedAt?: Date } = {},
  ) =>
    prisma.chatMessage.create({
      data: {
        threadId,
        senderId,
        content: extra.content ?? 'oi',
        messageType: extra.messageType ?? 'text',
        deletedAt: extra.deletedAt,
        createdAt,
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    for (const people of seeded) await cleanupChatPeople(prisma, people);
    await app.close();
  });

  describe('GET /chat/threads', () => {
    it('returns 401 without session', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/chat/threads')
        .expect(401);
    });

    it('lists only active threads of the caller ordered by updated_at desc, max 50', async () => {
      const people = await seed('inbox-order');
      const base = Date.now() - 1_000_000;
      for (let i = 0; i < 51; i += 1) {
        const vacancy = await prisma.vacancy.create({
          data: {
            title: `Vaga ${i}`,
            slug: `vaga-order-${randomUUID()}`,
            shelterId: people.shelterId,
            status: 'active',
            isPublished: true,
          },
        });
        const threadId = await createThread(prisma, people, {
          vacancyId: vacancy.id,
        });
        await prisma.chatThread.update({
          where: { id: threadId },
          data: { updatedAt: new Date(base + i * 1000) },
        });
      }
      const archivedId = await createThread(prisma, people, {
        status: 'archived',
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/chat/threads')
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200);
      const threads = (res.body as { threads: InboxThread[] }).threads;

      expect(threads).toHaveLength(50);
      expect(threads[0].vacancy_title).toBe('Vaga 50');
      const stamps = threads.map((t) => Date.parse(t.updated_at));
      expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);
      expect(threads.some((t) => t.id === archivedId)).toBe(false);

      const outsider = await request(app.getHttpServer())
        .get('/api/v1/chat/threads')
        .set('Cookie', authCookie(people.outsider.token))
        .expect(200);
      expect(outsider.body).toEqual({ threads: [] });
    });

    it('names the shelter for the volunteer and the volunteer for the shelter', async () => {
      const people = await seed('inbox-names');
      const threadId = await createThread(prisma, people);
      await message(threadId, people.shelterOwner.id, new Date(), {
        content: 'Olá!',
      });

      const asVolunteer = await request(app.getHttpServer())
        .get('/api/v1/chat/threads')
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200);
      const [forVolunteer] = (asVolunteer.body as { threads: InboxThread[] })
        .threads;
      expect(forVolunteer).toMatchObject({
        id: threadId,
        status: 'active',
        volunteer_profile_id: people.volunteerUser.id,
        shelter_profile_id: people.shelterOwner.id,
        vacancy_title: 'Vaga inbox-names',
        other_participant_name: 'Abrigo inbox-names',
        last_message: {
          content: 'Olá!',
          sender_id: people.shelterOwner.id,
          message_type: 'text',
        },
        unread_count: 1,
      });
      expect(forVolunteer.vacancy_slug).toMatch(/^vaga-inbox-names-/);

      const asShelter = await request(app.getHttpServer())
        .get('/api/v1/chat/threads')
        .set('Cookie', authCookie(people.shelterOwner.token))
        .expect(200);
      expect(
        (asShelter.body as { threads: InboxThread[] }).threads[0],
      ).toMatchObject({
        other_participant_name: 'Voluntário inbox-names',
        unread_count: 0,
      });
    });
  });

  describe('unread counts', () => {
    it('counts messages from others after last_read_at, ignoring deleted and including system', async () => {
      const people = await seed('unread');
      const threadId = await createThread(prisma, people);
      const readAt = new Date(Date.now() - 60_000);
      await prisma.chatParticipant.updateMany({
        where: { threadId, profileId: people.volunteerUser.id },
        data: { lastReadAt: readAt },
      });
      const before = new Date(readAt.getTime() - 1000);
      const after = new Date(readAt.getTime() + 1000);
      await message(threadId, people.shelterOwner.id, before);
      await message(threadId, people.shelterOwner.id, after);
      await message(threadId, people.shelterOwner.id, after, {
        messageType: 'system',
      });
      await message(threadId, people.shelterOwner.id, after, {
        deletedAt: new Date(),
      });
      await message(threadId, people.volunteerUser.id, after);

      const inbox = await request(app.getHttpServer())
        .get('/api/v1/chat/threads')
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200);
      expect(
        (inbox.body as { threads: InboxThread[] }).threads[0].unread_count,
      ).toBe(2);

      await request(app.getHttpServer())
        .get('/api/v1/chat/unread-count')
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200, { count: 2 });
    });

    it('total unread sums only active threads where the participant is active', async () => {
      const people = await seed('unread-total');
      const activeId = await createThread(prisma, people);
      const otherVacancy = await prisma.vacancy.create({
        data: {
          title: 'Outra',
          slug: `outra-${randomUUID()}`,
          shelterId: people.shelterId,
          status: 'active',
          isPublished: true,
        },
      });
      const archivedId = await createThread(prisma, people, {
        vacancyId: otherVacancy.id,
        status: 'archived',
      });
      const thirdVacancy = await prisma.vacancy.create({
        data: {
          title: 'Terceira',
          slug: `terceira-${randomUUID()}`,
          shelterId: people.shelterId,
          status: 'active',
          isPublished: true,
        },
      });
      const inactiveId = await createThread(prisma, people, {
        vacancyId: thirdVacancy.id,
      });
      await prisma.chatParticipant.updateMany({
        where: { threadId: inactiveId, profileId: people.volunteerUser.id },
        data: { isActive: false },
      });
      const later = new Date(Date.now() + 5000);
      for (const threadId of [activeId, archivedId, inactiveId]) {
        await message(threadId, people.shelterOwner.id, later);
      }

      await request(app.getHttpServer())
        .get('/api/v1/chat/unread-count')
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200, { count: 1 });
    });
  });
});
