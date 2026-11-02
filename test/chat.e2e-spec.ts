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

  describe('messages', () => {
    type MessageBody = {
      id: string;
      thread_id: string;
      sender_id: string;
      content: string;
      message_type: string;
      status: string;
      edited_at: string | null;
      created_at: string;
    };
    let people: ChatPeople;
    let threadId: string;
    const server = () => app.getHttpServer();
    const path = (suffix = '') => `/api/v1/chat/threads/${threadId}${suffix}`;
    const send = (token: string, content: unknown) =>
      request(server())
        .post(path('/messages'))
        .set('Cookie', authCookie(token))
        .send({ content });

    beforeEach(async () => {
      people = await seed(`msg-${randomUUID().slice(0, 6)}`);
      threadId = await createThread(prisma, people);
    });

    it('pages backwards 30 at a time with created_at|id cursor and returns oldest-first', async () => {
      const base = Date.now() - 100_000;
      for (let i = 0; i < 35; i += 1) {
        await message(
          threadId,
          people.shelterOwner.id,
          new Date(base + (i === 34 ? 33 : i) * 1000),
          { content: `m${i}` },
        );
      }
      const first = await request(server())
        .get(path('/messages'))
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200);
      const page1 = first.body as {
        messages: MessageBody[];
        has_more: boolean;
        next_cursor: string | null;
      };
      expect(page1.messages).toHaveLength(30);
      expect(page1.has_more).toBe(true);
      const stamps = page1.messages.map((m) => Date.parse(m.created_at));
      expect([...stamps].sort((a, b) => a - b)).toEqual(stamps);
      expect(page1.next_cursor).toBe(
        `${page1.messages[0].created_at}|${page1.messages[0].id}`,
      );

      const second = await request(server())
        .get(path('/messages'))
        .query({ cursor: page1.next_cursor })
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200);
      const page2 = second.body as {
        messages: MessageBody[];
        has_more: boolean;
        next_cursor: string | null;
      };
      expect(page2).toMatchObject({ has_more: false, next_cursor: null });
      const all = [...page2.messages, ...page1.messages].map((m) => m.content);
      expect(new Set(all).size).toBe(35);
      expect(all[0]).toBe('m0');
    });

    it('rejects empty and >5000 content with "Mensagem inválida"', async () => {
      for (const content of ['   ', 'x'.repeat(5001), 42]) {
        await send(people.volunteerUser.token, content).expect(400, {
          error: 'Mensagem inválida',
        });
      }
    });

    it('keeps "<3" and "<b>" as typed and returns the message shape', async () => {
      const res = await send(
        people.volunteerUser.token,
        '  te amo <3 <b>  ',
      ).expect(200);
      const body = res.body as { message: MessageBody; success: boolean };
      expect(body.success).toBe(true);
      expect(body.message).toMatchObject({
        thread_id: threadId,
        sender_id: people.volunteerUser.id,
        content: 'te amo <3 <b>',
        message_type: 'text',
        status: 'sent',
        edited_at: null,
      });
    });

    it('403 for non participant on list/send/edit/read', async () => {
      const own = await message(threadId, people.volunteerUser.id, new Date());
      const token = people.outsider.token;
      await request(server())
        .get(path('/messages'))
        .set('Cookie', authCookie(token))
        .expect(403, { error: 'Acesso negado' });
      await send(token, 'oi').expect(403, { error: 'Acesso negado' });
      await request(server())
        .patch(path(`/messages/${own.id}`))
        .set('Cookie', authCookie(token))
        .send({ content: 'x' })
        .expect(403, { error: 'Acesso negado' });
      await request(server())
        .post(path('/read'))
        .set('Cookie', authCookie(token))
        .expect(403, { error: 'Acesso negado' });
    });

    it('400 "Conversa encerrada" when thread status != active', async () => {
      await prisma.chatThread.update({
        where: { id: threadId },
        data: { status: 'closed' },
      });
      await send(people.volunteerUser.token, 'oi').expect(400, {
        error: 'Conversa encerrada',
      });
    });

    it('403 "Não é possível enviar mensagem nesta conversa" when either side blocked', async () => {
      await prisma.chatBlock.create({
        data: {
          blockerId: people.shelterOwner.id,
          blockedId: people.volunteerUser.id,
        },
      });
      await send(people.volunteerUser.token, 'oi').expect(403, {
        error: 'Não é possível enviar mensagem nesta conversa',
      });
      await send(people.shelterOwner.token, 'oi').expect(403);
    });

    it('429 on the 31st message within a minute', async () => {
      await prisma.chatMessage.createMany({
        data: Array.from({ length: 30 }, () => ({
          threadId,
          senderId: people.volunteerUser.id,
          content: 'spam',
        })),
      });
      await send(people.volunteerUser.token, 'mais uma').expect(429, {
        error: 'Limite de mensagens atingido. Aguarde um momento.',
      });
      await send(people.shelterOwner.token, 'abrigo pode').expect(200);
    });

    it('send bumps chat_threads.updated_at to the message created_at', async () => {
      const res = await send(people.volunteerUser.token, 'oi').expect(200);
      const thread = await prisma.chatThread.findUniqueOrThrow({
        where: { id: threadId },
      });
      expect(thread.updatedAt.toISOString()).toBe(
        (res.body as { message: MessageBody }).message.created_at,
      );
    });

    it('edit: only author, only text, not deleted, within 15 minutes', async () => {
      const edit = (id: string, token = people.volunteerUser.token) =>
        request(server())
          .patch(path(`/messages/${id}`))
          .set('Cookie', authCookie(token))
          .send({ content: '  editada  ' });
      const fresh = await message(
        threadId,
        people.volunteerUser.id,
        new Date(Date.now() - 14 * 60_000),
      );
      const ok = await edit(fresh.id).expect(200);
      expect((ok.body as { message: MessageBody }).message).toMatchObject({
        content: 'editada',
      });
      expect(
        (ok.body as { message: MessageBody }).message.edited_at,
      ).not.toBeNull();

      await edit(fresh.id, people.shelterOwner.token).expect(403, {
        error: 'Acesso negado',
      });
      const old = await message(
        threadId,
        people.volunteerUser.id,
        new Date(Date.now() - 15 * 60_000 - 1),
      );
      await edit(old.id).expect(400, {
        error: 'O tempo para editar esta mensagem expirou',
      });
      const system = await message(
        threadId,
        people.volunteerUser.id,
        new Date(),
        {
          messageType: 'system',
        },
      );
      await edit(system.id).expect(400, {
        error: 'Não é possível editar esta mensagem',
      });
      const deleted = await message(
        threadId,
        people.volunteerUser.id,
        new Date(),
        {
          deletedAt: new Date(),
        },
      );
      await edit(deleted.id).expect(400, {
        error: 'Mensagem já foi deletada',
      });
      await edit(randomUUID()).expect(404, {
        error: 'Mensagem não encontrada',
      });
    });

    it("read: sets last_read_at, flips others' sent to read, returns total unread", async () => {
      const incoming = await message(
        threadId,
        people.shelterOwner.id,
        new Date(Date.now() + 1000),
      );
      const own = await message(threadId, people.volunteerUser.id, new Date());

      const res = await request(server())
        .post(path('/read'))
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200);
      expect(res.body).toEqual({ success: true, unread_count: 0 });

      const [after, ownAfter] = await Promise.all([
        prisma.chatMessage.findUniqueOrThrow({ where: { id: incoming.id } }),
        prisma.chatMessage.findUniqueOrThrow({ where: { id: own.id } }),
      ]);
      expect(after.status).toBe('read');
      expect(ownAfter.status).toBe('sent');
    });
  });

  describe('moderation', () => {
    it('blocks, 409 "Usuário já bloqueado" on repeat, 400 on self and invalid input', async () => {
      const people = await seed(`block-${randomUUID().slice(0, 6)}`);
      const block = (body: unknown) =>
        request(app.getHttpServer())
          .post('/api/v1/chat/blocks')
          .set('Cookie', authCookie(people.volunteerUser.token))
          .send(body as object);

      await block({
        blocked_id: people.shelterOwner.id,
        reason: 'x'.repeat(600),
      }).expect(200, { success: true });
      const stored = await prisma.chatBlock.findFirstOrThrow({
        where: { blockerId: people.volunteerUser.id },
      });
      expect(stored.reason).toHaveLength(500);

      await block({ blocked_id: people.shelterOwner.id }).expect(409, {
        error: 'Usuário já bloqueado',
      });
      await block({ blocked_id: people.volunteerUser.id }).expect(400, {
        error: 'Não pode bloquear a si mesmo',
      });
      await block({}).expect(400, { error: 'Dados inválidos' });
    });

    it('reports, 409 "Denúncia já registrada" on same message, 400 "Dados inválidos" on missing/too long reason', async () => {
      const people = await seed(`report-${randomUUID().slice(0, 6)}`);
      const threadId = await createThread(prisma, people);
      const target = await message(
        threadId,
        people.shelterOwner.id,
        new Date(),
      );
      const report = (body: unknown) =>
        request(app.getHttpServer())
          .post('/api/v1/chat/reports')
          .set('Cookie', authCookie(people.volunteerUser.token))
          .send(body as object);
      const valid = {
        reported_user_id: people.shelterOwner.id,
        reason: '  ofensivo  ',
        thread_id: threadId,
        message_id: target.id,
      };

      await report(valid).expect(200, { success: true });
      const stored = await prisma.chatReport.findFirstOrThrow({
        where: { reporterId: people.volunteerUser.id },
      });
      expect(stored).toMatchObject({ reason: 'ofensivo', status: 'pending' });

      await report(valid).expect(409, { error: 'Denúncia já registrada' });
      await report({ ...valid, reason: '   ' }).expect(400, {
        error: 'Dados inválidos',
      });
      await report({ ...valid, reason: 'x'.repeat(1001) }).expect(400, {
        error: 'Dados inválidos',
      });
      await report({ reason: 'sem alvo' }).expect(400, {
        error: 'Dados inválidos',
      });
    });
  });

  describe('vacancy application', () => {
    const apply = (people: ChatPeople) =>
      request(app.getHttpServer())
        .post(`/api/v1/vacancies/${people.vacancyId}/apply`)
        .set('Cookie', authCookie(people.volunteerUser.token));

    it('apply creates application, thread, 2 participants and the system message atomically', async () => {
      const label = `apply-${randomUUID().slice(0, 6)}`;
      const people = await seed(label);
      const res = await apply(people).expect(200);
      const body = res.body as {
        success: boolean;
        thread_id: string;
        application: { id: string };
      };
      expect(body.success).toBe(true);

      const thread = await prisma.chatThread.findUniqueOrThrow({
        where: { id: body.thread_id },
        include: { participants: true, messages: true },
      });
      expect(thread).toMatchObject({
        vacancyId: people.vacancyId,
        volunteerProfileId: people.volunteerUser.id,
        shelterProfileId: people.shelterOwner.id,
        shelterId: people.shelterId,
        volunteerId: people.volunteerId,
        applicationId: body.application.id,
        status: 'active',
      });
      expect(
        thread.participants.map((p) => `${p.role}:${p.profileId}`).sort(),
      ).toEqual(
        [
          `shelter:${people.shelterOwner.id}`,
          `volunteer:${people.volunteerUser.id}`,
        ].sort(),
      );
      expect(thread.messages).toHaveLength(1);
      expect(thread.messages[0]).toMatchObject({
        senderId: people.volunteerUser.id,
        messageType: 'system',
        content: `Candidatura enviada para a vaga "Vaga ${label}". Vocês já podem trocar mensagens!`,
      });
    });

    it('apply twice returns 409 and keeps a single thread', async () => {
      const people = await seed(`apply2-${randomUUID().slice(0, 6)}`);
      await apply(people).expect(200);
      await apply(people).expect(409, {
        error: 'Você já se candidatou a esta vaga',
      });
      expect(
        await prisma.chatThread.count({
          where: { vacancyId: people.vacancyId },
        }),
      ).toBe(1);
    });

    it('apply to a vacancy whose shelter has no profile_id returns 404 "Abrigo não encontrado" and stores nothing', async () => {
      const people = await seed(`apply3-${randomUUID().slice(0, 6)}`);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.$executeRaw`UPDATE shelters SET profile_id = NULL WHERE id = ${people.shelterId}::uuid`;
      });
      await apply(people).expect(404, { error: 'Abrigo não encontrado' });
      expect(
        await prisma.vacancyApplication.count({
          where: { vacancyId: people.vacancyId },
        }),
      ).toBe(0);
    });

    it('reuses an existing thread for the pair and completes missing participants', async () => {
      const people = await seed(`apply4-${randomUUID().slice(0, 6)}`);
      const orphan = await prisma.chatThread.create({
        data: {
          vacancyId: people.vacancyId,
          volunteerProfileId: people.volunteerUser.id,
          shelterProfileId: people.shelterOwner.id,
          shelterId: people.shelterId,
          volunteerId: people.volunteerId,
          participants: {
            create: [{ profileId: people.volunteerUser.id, role: 'volunteer' }],
          },
        },
      });
      const res = await apply(people).expect(200);
      expect((res.body as { thread_id: string }).thread_id).toBe(orphan.id);
      expect(
        await prisma.chatParticipant.count({ where: { threadId: orphan.id } }),
      ).toBe(2);
    });

    it('rolls back the application when the conversation cannot be created', async () => {
      const people = await seed(`apply9-${randomUUID().slice(0, 6)}`);
      // Título enorme faz a mensagem de sistema violar o CHECK de 5000
      // caracteres dentro da transação.
      await prisma.vacancy.update({
        where: { id: people.vacancyId },
        data: { title: 'x'.repeat(5000) },
      });
      await apply(people).expect(500);
      expect(
        await prisma.vacancyApplication.count({
          where: { vacancyId: people.vacancyId },
        }),
      ).toBe(0);
      expect(
        await prisma.chatThread.count({
          where: { vacancyId: people.vacancyId },
        }),
      ).toBe(0);
    });

    it('shelter owner receives the conversation in the inbox with the system message unread', async () => {
      const label = `apply5-${randomUUID().slice(0, 6)}`;
      const people = await seed(label);
      await apply(people).expect(200);
      const inbox = await request(app.getHttpServer())
        .get('/api/v1/chat/threads')
        .set('Cookie', authCookie(people.shelterOwner.token))
        .expect(200);
      expect(
        (inbox.body as { threads: InboxThread[] }).threads[0],
      ).toMatchObject({
        other_participant_name: `Voluntário ${label}`,
        last_message: { message_type: 'system' },
        unread_count: 1,
      });
    });

    it('my-status exposes threadId and shelterProfileId for an applicant', async () => {
      const people = await seed(`apply6-${randomUUID().slice(0, 6)}`);
      const applied = await apply(people).expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${people.vacancyId}/my-status`)
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200, {
          isOwner: false,
          hasApplied: true,
          threadId: (applied.body as { thread_id: string }).thread_id,
          shelterProfileId: people.shelterOwner.id,
        });
      await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${people.vacancyId}/my-status`)
        .set('Cookie', authCookie(people.outsider.token))
        .expect(200, {
          isOwner: false,
          hasApplied: false,
          threadId: null,
          shelterProfileId: null,
        });
    });

    it('applications list exposes thread_id per applicant', async () => {
      const people = await seed(`apply7-${randomUUID().slice(0, 6)}`);
      const applied = await apply(people).expect(200);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/vacancies/${people.vacancyId}/applications`)
        .set('Cookie', authCookie(people.shelterOwner.token))
        .expect(200);
      const threadId = (applied.body as { thread_id: string }).thread_id;
      expect(threadId).toEqual(expect.any(String));
      expect(
        (res.body as { applications: { thread_id: string | null }[] })
          .applications[0].thread_id,
      ).toBe(threadId);
    });

    it('lists the volunteer threads by vacancy for the vacancies page', async () => {
      const people = await seed(`apply8-${randomUUID().slice(0, 6)}`);
      const applied = await apply(people).expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/chat/threads/by-vacancy')
        .set('Cookie', authCookie(people.volunteerUser.token))
        .expect(200, {
          threads: {
            [people.vacancyId]: (applied.body as { thread_id: string })
              .thread_id,
          },
        });
      await request(app.getHttpServer())
        .get('/api/v1/chat/threads/by-vacancy')
        .set('Cookie', authCookie(people.shelterOwner.token))
        .expect(200, { threads: {} });
    });

    it('finds the most recent active thread with a volunteer by slug, only for the shelter side', async () => {
      const people = await seed(`bysl-${randomUUID().slice(0, 6)}`);
      const slug = `vol-${randomUUID().slice(0, 8)}`;
      await prisma.volunteer.update({
        where: { id: people.volunteerId },
        data: { slug },
      });
      const older = await createThread(prisma, people);
      const otherVacancy = await prisma.vacancy.create({
        data: {
          title: 'Mais recente',
          slug: `recente-${randomUUID()}`,
          shelterId: people.shelterId,
          status: 'active',
          isPublished: true,
        },
      });
      const newer = await createThread(prisma, people, {
        vacancyId: otherVacancy.id,
      });
      await prisma.chatThread.update({
        where: { id: older },
        data: { updatedAt: new Date(Date.now() - 60_000) },
      });
      const lookup = (token: string, value = slug) =>
        request(app.getHttpServer())
          .get(`/api/v1/chat/threads/with-volunteer/${value}`)
          .set('Cookie', authCookie(token));

      await lookup(people.shelterOwner.token).expect(200, { thread_id: newer });
      await lookup(people.shelterOwner.token, 'nao-existe').expect(200, {
        thread_id: null,
      });
      await lookup(people.volunteerUser.token).expect(200, { thread_id: null });
      await lookup(people.outsider.token).expect(200, { thread_id: null });
    });
  });
});
