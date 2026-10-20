import { defaultChatbotConfig } from '@brainstack/shared';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaClient } from '../../src/generated/prisma/client';
import { createAdminPrisma } from './admin-prisma';
import { SESSION_COOKIE } from '../../src/modules/auth/auth.constants';
import { SessionsService } from '../../src/modules/auth/sessions.service';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { fakeEmbeddingService } from './fake-embedding';

interface LeadsBody {
  items: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    conversationId: string | null;
    answers: { questionId: string; question: string | null; answer: string }[];
  }[];
}

/**
 * M7-41: the widget's contact form (POST /v1/public/conversations/:id/lead).
 * A visitor with a conversation token saves a lead in that conversation's
 * own workspace, and nowhere else. Runs on real Postgres.
 */
describe('Public contact form (M7-41)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (who: string) =>
    `lead-${run}-${who}@example.test`.toLowerCase();
  // A caller address of its own, so the limits kept in Postgres never count
  // other tests or earlier runs against this one.
  const callerIp = `10.${parseInt(run.slice(0, 2), 16)}.${parseInt(run.slice(2, 4), 16)}.${parseInt(run.slice(4, 6), 16) || 1}`;
  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaClient;
  const ids = { a: '', b: '', botA: '', botB: '' };
  const publicIds = { a: '', b: '' };
  const userIds = { ownerA: '', ownerB: '' };
  const cookies = { ownerA: '', ownerB: '' };
  const chats = {
    a: { id: '', token: '' },
    b: { id: '', token: '' },
  };

  const post = (path: string, token?: string) => {
    const req = request(http)
      .post(path)
      .set('X-Requested-With', 'fetch')
      .set('X-Forwarded-For', callerIp);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const leadsOf = async (cookie: string) =>
    (await request(http).get('/v1/leads').set('Cookie', cookie).expect(200))
      .body as LeadsBody;

  async function startChat(publicId: string) {
    const res = await post(`/v1/public/chatbots/${publicId}/conversations`)
      .send({ visitorId: `visitor_${run}_${publicId.slice(-4)}` })
      .expect(201);
    return res.body as { conversationId: string; conversationToken: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmbeddingService)
      .useValue(fakeEmbeddingService)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    app.set('trust proxy', true);
    await app.init();
    http = app.getHttpServer();
    prisma = createAdminPrisma();

    const workspaces = app.get(WorkspacesService);
    const sessions = app.get(SessionsService);
    for (const who of ['ownerA', 'ownerB'] as const) {
      const user = await prisma.user.create({
        data: {
          email: email(who),
          name: who,
          passwordHash: 'not-used',
          emailVerifiedAt: new Date(),
        },
      });
      userIds[who] = user.id;
    }
    const a = await workspaces.createWithOwner({
      name: `Lead Alpha ${run}`,
      ownerUserId: userIds.ownerA,
    });
    const b = await workspaces.createWithOwner({
      name: `Lead Bravo ${run}`,
      ownerUserId: userIds.ownerB,
    });
    Object.assign(ids, {
      a: a.id,
      b: b.id,
      botA: a.chatbots[0].id,
      botB: b.chatbots[0].id,
    });
    publicIds.a = a.chatbots[0].publicId;
    publicIds.b = b.chatbots[0].publicId;
    for (const [workspaceId, chatbotId] of [
      [ids.a, ids.botA],
      [ids.b, ids.botB],
    ]) {
      const version = await prisma.chatbotVersion.create({
        data: {
          workspaceId,
          chatbotId,
          version: 1,
          config: defaultChatbotConfig('Lead test'),
        },
      });
      await prisma.chatbot.update({
        where: { id: chatbotId },
        data: { publishedVersionId: version.id },
      });
    }

    const login = async (userId: string, workspaceId: string) =>
      `${SESSION_COOKIE}=${
        (await sessions.create({ userId, activeWorkspaceId: workspaceId }))
          .token
      }`;
    cookies.ownerA = await login(userIds.ownerA, ids.a);
    cookies.ownerB = await login(userIds.ownerB, ids.b);

    const chatA = await startChat(publicIds.a);
    chats.a = { id: chatA.conversationId, token: chatA.conversationToken };
    const chatB = await startChat(publicIds.b);
    chats.b = { id: chatB.conversationId, token: chatB.conversationToken };
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.workspace.deleteMany({
        where: { name: { endsWith: ` ${run}` } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: `lead-${run}-` } },
      });
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  it("saves a lead in the conversation's own workspace, with what they need", async () => {
    await post(`/v1/public/conversations/${chats.a.id}/lead`, chats.a.token)
      .send({
        name: 'Ana Rahman',
        email: 'Ana@Example.test',
        phone: '+8801711000000',
        message: 'I want a quote for 3 units',
      })
      .expect(204);

    const mine = await leadsOf(cookies.ownerA);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]).toMatchObject({
      name: 'Ana Rahman',
      email: 'ana@example.test',
      phone: '+8801711000000',
      conversationId: chats.a.id,
      answers: [
        {
          questionId: 'request',
          question: 'What they need',
          answer: 'I want a quote for 3 units',
        },
      ],
    });
    // Workspace B never sees it.
    expect((await leadsOf(cookies.ownerB)).items).toHaveLength(0);
  });

  it('fills in the same lead when the form is sent again', async () => {
    await post(`/v1/public/conversations/${chats.a.id}/lead`, chats.a.token)
      .send({ name: 'Ana R.', phone: '+8801711000000' })
      .expect(204);
    const mine = await leadsOf(cookies.ownerA);
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].name).toBe('Ana R.');
  });

  it("refuses a missing token, a made-up one and another conversation's token (401)", async () => {
    const path = `/v1/public/conversations/${chats.a.id}/lead`;
    const body = { name: 'Eve', email: 'eve@example.test' };
    await post(path).send(body).expect(401);
    await post(path, 'not-a-token').send(body).expect(401);
    // B's token opens B's conversation only.
    await post(path, chats.b.token).send(body).expect(401);
    expect((await leadsOf(cookies.ownerB)).items).toHaveLength(0);
    expect((await leadsOf(cookies.ownerA)).items).toHaveLength(1);
  });

  it('saves into the workspace of the token, even for a conversation id from elsewhere', async () => {
    await post(`/v1/public/conversations/${chats.b.id}/lead`, chats.b.token)
      .send({ name: 'Bob', email: 'bob@example.test' })
      .expect(204);
    const theirs = await leadsOf(cookies.ownerB);
    expect(theirs.items.map((l) => l.name)).toEqual(['Bob']);
    expect(theirs.items[0].conversationId).toBe(chats.b.id);
    expect(
      (await leadsOf(cookies.ownerA)).items.map((l) => l.name),
    ).not.toContain('Bob');
  });

  it('needs a name and a way to be reached, and refuses unknown fields (400)', async () => {
    const path = `/v1/public/conversations/${chats.a.id}/lead`;
    await post(path, chats.a.token)
      .send({ email: 'x@example.test' })
      .expect(400);
    await post(path, chats.a.token).send({ name: 'No contact' }).expect(400);
    await post(path, chats.a.token)
      .send({ name: 'Bad mail', email: 'not-an-email' })
      .expect(400);
    await post(path, chats.a.token)
      .send({ name: 'Eve', email: 'e@example.test', workspaceId: ids.b })
      .expect(400);
    await post(path, chats.a.token)
      .send({ name: 'Eve', email: 'e@example.test', chatbotId: ids.botB })
      .expect(400);
    expect((await leadsOf(cookies.ownerB)).items.map((l) => l.name)).toEqual([
      'Bob',
    ]);
  });

  it('is a 404 once the chatbot is switched off', async () => {
    await prisma.chatbot.update({
      where: { id: ids.botA },
      data: { status: 'DISABLED' },
    });
    await post(`/v1/public/conversations/${chats.a.id}/lead`, chats.a.token)
      .send({ name: 'Late', email: 'late@example.test' })
      .expect(404);
    await prisma.chatbot.update({
      where: { id: ids.botA },
      data: { status: 'ENABLED' },
    });
  });
});
