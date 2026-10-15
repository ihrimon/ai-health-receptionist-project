import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { defaultChatbotConfig } from '@brainstack/shared';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/database/prisma.service';
import { WorkspaceRole } from '../../src/generated/prisma/client';
import { SESSION_COOKIE } from '../../src/modules/auth/auth.constants';
import { SessionsService } from '../../src/modules/auth/sessions.service';
import { LlmChatClient } from '../../src/modules/llm/llm-chat.client';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { KnowledgeService } from '../../src/modules/knowledge/knowledge.service';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { S3_CLIENT } from '../../src/storage/storage.service';
import { runWithTenant } from '../../src/tenancy/tenant-context';
import { TENANT_PRISMA, TenantPrisma } from '../../src/tenancy/tenant-prisma';
import { FAKE_EMBEDDING_MODEL, fakeEmbeddingService } from './fake-embedding';

interface ChatEventRow {
  type: string;
  text?: string;
  sources?: { title: string }[];
  conversationId?: string | null;
  answeredBy?: string;
}

/** The events of a chat response (text/event-stream), in order. */
function chatEvents(res: { text: string; headers: Record<string, unknown> }) {
  expect(String(res.headers['content-type'])).toContain('text/event-stream');
  const events: ChatEventRow[] = res.text
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block): ChatEventRow => {
      const type = /^event: (.+)$/m.exec(block)?.[1] ?? '';
      const data = /^data: (.+)$/m.exec(block)?.[1] ?? '{}';
      return { ...(JSON.parse(data) as Partial<ChatEventRow>), type };
    });
  return {
    events,
    reply: events
      .map((e) => (e.type === 'delta' ? (e.text ?? '') : ''))
      .join(''),
    sources: events.find((e) => e.type === 'sources')?.sources ?? [],
    done: events.find((e) => e.type === 'done'),
    conversationId:
      events.find((e) => e.type === 'done')?.conversationId ?? null,
  };
}

/**
 * M1-25, M2-21 (W4): two workspaces, proving A's users can't read or change
 * B's data — through the HTTP API and through the tenant Prisma client.
 * Runs on a real Postgres and MinIO (no Redis); background jobs (knowledge
 * indexing) run in the app as in production, with a fake embedding model.
 */
describe('Tenant isolation (M1-25)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (who: string) => `iso-${run}-${who}@example.test`;

  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaService;
  let db: TenantPrisma;
  // No real LLM calls: the preview test checks what would be sent, and
  // every key "verifies".
  const fakeLlm = {
    streamWith: jest.fn(async function* (
      credentials: { id: string }[],
      messages: unknown[],
    ) {
      await Promise.resolve();
      yield { type: 'text', text: 'stub ' };
      yield { type: 'text', text: 'answer' };
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: messages.length ? 'stub answer' : '',
        },
        credentialId: credentials[0].id,
        model: 'stub-model',
        usage: { inputTokens: 100, outputTokens: 7 },
      };
    }),
    verify: jest.fn(() => Promise.resolve()),
  };

  // Workspace A: owner + viewer. Workspace B: owner. A2: second workspace
  // of A's owner, for the switch test.
  const ids = { a: '', a2: '', b: '', botA: '', botB: '' };
  const users = { ownerA: '', viewerA: '', ownerB: '' };
  const cookies = { ownerA: '', viewerA: '', ownerB: '' };

  async function createUser(who: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email: email(who), name: who, passwordHash: 'not-used' },
    });
    return user.id;
  }

  async function login(userId: string, workspaceId: string): Promise<string> {
    const { token } = await app
      .get(SessionsService)
      .create({ userId, activeWorkspaceId: workspaceId });
    return `${SESSION_COOKIE}=${token}`;
  }

  const as = (cookie: string) => ({
    get: (path: string) => request(http).get(path).set('Cookie', cookie),
    post: (path: string) =>
      request(http)
        .post(path)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
    patch: (path: string) =>
      request(http)
        .patch(path)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
    put: (path: string) =>
      request(http)
        .put(path)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
    delete: (path: string) =>
      request(http)
        .delete(path)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
  });

  // Prisma queries are lazy: they run when awaited, so await inside the
  // context (as request handlers do).
  const inWorkspace = <T>(workspaceId: string, fn: () => PromiseLike<T>) =>
    runWithTenant(
      { workspaceId, userId: 'test', role: WorkspaceRole.OWNER },
      async () => await fn(),
    );

  /** Polls a knowledge source until background indexing settles on `status`. */
  /** Polls until `check` returns a value (background jobs settle). */
  async function waitUntil<T>(
    what: string,
    check: () => Promise<T | null | undefined | false>,
  ): Promise<T> {
    for (let i = 0; i < 100; i++) {
      const value = await check();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${what}`);
  }

  async function waitForStatus(
    cookie: string,
    id: string,
    status: 'READY' | 'FAILED',
  ): Promise<{ status: string; error: string | null }> {
    for (let i = 0; i < 100; i++) {
      const res = await as(cookie).get(`/v1/knowledge-sources/${id}`);
      const body = res.body as { status: string; error: string | null };
      if (body.status === status) return body;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Source ${id} never reached ${status}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmbeddingService)
      .useValue(fakeEmbeddingService)
      .overrideProvider(LlmChatClient)
      .useValue(fakeLlm)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    db = app.get<TenantPrisma>(TENANT_PRISMA);

    const workspaces = app.get(WorkspacesService);
    users.ownerA = await createUser('owner-a');
    users.viewerA = await createUser('viewer-a');
    users.ownerB = await createUser('owner-b');

    const a = await workspaces.createWithOwner({
      name: `Iso A ${run}`,
      ownerUserId: users.ownerA,
    });
    const a2 = await workspaces.createWithOwner({
      name: `Iso A2 ${run}`,
      ownerUserId: users.ownerA,
    });
    const b = await workspaces.createWithOwner({
      name: `Iso B ${run}`,
      ownerUserId: users.ownerB,
    });
    Object.assign(ids, {
      a: a.id,
      a2: a2.id,
      b: b.id,
      botA: a.chatbots[0].id,
      botB: b.chatbots[0].id,
    });
    await prisma.workspaceMember.create({
      data: {
        workspaceId: ids.a,
        userId: users.viewerA,
        role: WorkspaceRole.VIEWER,
      },
    });

    cookies.ownerA = await login(users.ownerA, ids.a);
    cookies.viewerA = await login(users.viewerA, ids.a);
    cookies.ownerB = await login(users.ownerB, ids.b);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.workspace.deleteMany({
        where: { id: { in: [ids.a, ids.a2, ids.b].filter(Boolean) } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: `iso-${run}-` } },
      });
    }
    await app?.close();
  });

  describe('HTTP API', () => {
    it("me shows only the user's own workspaces", async () => {
      const res = await as(cookies.ownerA).get('/v1/auth/me').expect(200);
      const body = res.body as {
        activeWorkspace: { id: string };
        memberships: { workspace: { id: string } }[];
      };
      expect(body.activeWorkspace.id).toBe(ids.a);
      expect(body.memberships.map((m) => m.workspace.id).sort()).toEqual(
        [ids.a, ids.a2].sort(),
      );
    });

    it("switching to another tenant's workspace is a 404, not a 403", async () => {
      await as(cookies.ownerA)
        .post('/v1/workspaces/switch')
        .send({ workspaceId: ids.b })
        .expect(404);

      const me = await as(cookies.ownerA).get('/v1/auth/me').expect(200);
      expect(
        (me.body as { activeWorkspace: { id: string } }).activeWorkspace.id,
      ).toBe(ids.a);
    });

    it('switching to a workspace that does not exist is the same 404', async () => {
      await as(cookies.ownerA)
        .post('/v1/workspaces/switch')
        .send({ workspaceId: randomUUID() })
        .expect(404);
    });

    it('switching between your own workspaces works', async () => {
      await as(cookies.ownerA)
        .post('/v1/workspaces/switch')
        .send({ workspaceId: ids.a2 })
        .expect(204);
      const me = await as(cookies.ownerA).get('/v1/auth/me').expect(200);
      expect(
        (me.body as { activeWorkspace: { id: string } }).activeWorkspace.id,
      ).toBe(ids.a2);

      await as(cookies.ownerA)
        .post('/v1/workspaces/switch')
        .send({ workspaceId: ids.a })
        .expect(204);
    });

    it("renaming changes only the caller's workspace", async () => {
      const res = await as(cookies.ownerA)
        .patch('/v1/workspace')
        .send({ name: 'Renamed A' })
        .expect(200);
      expect((res.body as { id: string }).id).toBe(ids.a);

      const [a, b] = await Promise.all([
        prisma.workspace.findUniqueOrThrow({ where: { id: ids.a } }),
        prisma.workspace.findUniqueOrThrow({ where: { id: ids.b } }),
      ]);
      expect(a.name).toBe('Renamed A');
      expect(b.name).toBe(`Iso B ${run}`);
    });

    it('a viewer cannot do an owner-only action (403)', async () => {
      await as(cookies.viewerA)
        .patch('/v1/workspace')
        .send({ name: 'Viewer was here' })
        .expect(403);
    });

    it('no session is a 401', async () => {
      await request(http)
        .patch('/v1/workspace')
        .set('X-Requested-With', 'fetch')
        .send({ name: 'x' })
        .expect(401);
    });

    it('a user removed from their active workspace falls back to one they still belong to', async () => {
      const member = await prisma.workspaceMember.create({
        data: {
          workspaceId: ids.b,
          userId: users.viewerA,
          role: WorkspaceRole.VIEWER,
        },
      });
      const cookie = await login(users.viewerA, ids.b);
      await prisma.workspaceMember.delete({
        where: {
          workspaceId_userId: {
            workspaceId: member.workspaceId,
            userId: users.viewerA,
          },
        },
      });

      const me = await as(cookie).get('/v1/auth/me').expect(200);
      const body = me.body as { activeWorkspace: { id: string }; role: string };
      expect(body.activeWorkspace.id).toBe(ids.a);
      expect(body.role).toBe('VIEWER');
    });
  });

  describe('rate limits in Postgres', () => {
    it('allows 5 wrong logins a minute, then answers 429 with Retry-After', async () => {
      // Counters outlive a test run in the test database; start clean.
      await prisma.rateLimit.deleteMany({});
      const attempt = () =>
        request(http)
          .post('/v1/auth/login')
          .set('X-Requested-With', 'fetch')
          .send({ email: email('nobody'), password: 'wrong-password-123' });

      for (let i = 0; i < 5; i++) await attempt().expect(401);
      const blocked = await attempt().expect(429);

      const retryAfter = Number(blocked.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
      await prisma.rateLimit.deleteMany({});
    });
  });

  describe('Chatbot API (M2-21)', () => {
    interface ChatbotBody {
      id: string;
      status: string;
      draftConfig: { identity: { botName: string } };
      publishedVersion: { version: number } | null;
      hasUnpublishedChanges: boolean;
      allowedDomains: string[];
    }
    const draftA = () => {
      const config = defaultChatbotConfig('Iso A');
      config.identity.botName = 'Ava';
      config.business.description = 'We sell shoes.';
      return config;
    };
    const botB = () =>
      prisma.chatbot.findUniqueOrThrow({
        where: { id: ids.botB },
        include: { versions: true },
      });

    it('each workspace sees only its own chatbot', async () => {
      const a = await as(cookies.ownerA).get('/v1/chatbot').expect(200);
      const b = await as(cookies.ownerB).get('/v1/chatbot').expect(200);
      expect((a.body as ChatbotBody).id).toBe(ids.botA);
      expect((b.body as ChatbotBody).id).toBe(ids.botB);
    });

    it("saving a draft changes only the caller's chatbot", async () => {
      const res = await as(cookies.ownerA)
        .put('/v1/chatbot/draft')
        .send(draftA())
        .expect(200);
      expect((res.body as ChatbotBody).draftConfig.identity.botName).toBe(
        'Ava',
      );

      const b = await botB();
      expect(
        (b.draftConfig as { identity: { botName: string } }).identity.botName,
      ).toBe('Assistant');
    });

    it('rejects an invalid draft with field details (400)', async () => {
      const draft = draftA();
      draft.widget.primaryColor = 'teal';
      const res = await as(cookies.ownerA)
        .put('/v1/chatbot/draft')
        .send(draft)
        .expect(400);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ path: 'widget.primaryColor' }],
      });
    });

    it("publishing creates a version in the caller's workspace only", async () => {
      // Publishing needs knowledge to answer from (D-4 §4).
      await as(cookies.ownerA)
        .post('/v1/faqs')
        .send({ question: 'Opening hours?', answer: '9 to 5.' })
        .expect(201);

      const res = await as(cookies.ownerA)
        .post('/v1/chatbot/publish')
        .expect(200);
      const body = res.body as ChatbotBody;
      expect(body.publishedVersion?.version).toBe(1);
      expect(body.hasUnpublishedChanges).toBe(false);

      const version = await prisma.chatbotVersion.findFirstOrThrow({
        where: { chatbotId: ids.botA },
      });
      expect(version.workspaceId).toBe(ids.a);
      expect(version.publishedById).toBe(users.ownerA);

      const b = await botB();
      expect(b.publishedVersionId).toBeNull();
      expect(b.versions).toEqual([]);
    });

    it('publishing an unready draft is a 400 with the reasons', async () => {
      const res = await as(cookies.ownerB)
        .post('/v1/chatbot/publish')
        .expect(400);
      expect(res.body).toMatchObject({
        details: [
          { code: 'BUSINESS_DESCRIPTION_MISSING' },
          { code: 'KNOWLEDGE_MISSING' },
        ],
      });
    });

    it("status and allowed domains change only the caller's chatbot", async () => {
      await as(cookies.ownerA)
        .patch('/v1/chatbot/status')
        .send({ status: 'DISABLED' })
        .expect(200);
      const res = await as(cookies.ownerA)
        .put('/v1/chatbot/allowed-domains')
        .send({ domains: ['Shop.Example.com', '*.example.com'] })
        .expect(200);
      expect((res.body as ChatbotBody).allowedDomains).toEqual([
        'shop.example.com',
        '*.example.com',
      ]);

      const b = await botB();
      expect(b.status).toBe('ENABLED');
      expect(b.allowedDomains).toEqual([]);

      await as(cookies.ownerA)
        .patch('/v1/chatbot/status')
        .send({ status: 'ENABLED' })
        .expect(200);
    });

    it('discarding the draft brings back the live config', async () => {
      const edited = draftA();
      edited.identity.botName = 'Changed';
      await as(cookies.ownerA)
        .put('/v1/chatbot/draft')
        .send(edited)
        .expect(200);

      const res = await as(cookies.ownerA)
        .post('/v1/chatbot/discard-draft')
        .expect(200);
      const body = res.body as ChatbotBody;
      expect(body.draftConfig.identity.botName).toBe('Ava');
      expect(body.hasUnpublishedChanges).toBe(false);
    });

    it('a viewer can read the chatbot but not change it (403)', async () => {
      await as(cookies.viewerA).get('/v1/chatbot').expect(200);
      await as(cookies.viewerA)
        .put('/v1/chatbot/draft')
        .send(draftA())
        .expect(403);
      await as(cookies.viewerA).post('/v1/chatbot/publish').expect(403);
      await as(cookies.viewerA)
        .patch('/v1/chatbot/status')
        .send({ status: 'DISABLED' })
        .expect(403);
    });
  });

  describe('Knowledge base API (M2-21)', () => {
    // A's items, created through the API; B then tries to reach them.
    const itemsA = { faq: '', customAnswer: '', source: '' };
    const paths = () => ({
      faq: `/v1/faqs/${itemsA.faq}`,
      customAnswer: `/v1/custom-answers/${itemsA.customAnswer}`,
      source: `/v1/knowledge-sources/${itemsA.source}`,
    });
    const listIds = async (cookie: string, path: string) =>
      ((await as(cookie).get(path).expect(200)).body as { id: string }[]).map(
        (row) => row.id,
      );

    beforeAll(async () => {
      const owner = as(cookies.ownerA);
      const faq = await owner
        .post('/v1/faqs')
        .send({ question: 'Do you ship abroad?', answer: 'Yes.' })
        .expect(201);
      const customAnswer = await owner
        .post('/v1/custom-answers')
        .send({ triggerQuestion: 'Who owns the shop?', answer: 'Rina.' })
        .expect(201);
      const source = await owner
        .post('/v1/knowledge-sources')
        .send({ type: 'POLICY', title: 'Returns', content: '30 days.' })
        .expect(201);
      itemsA.faq = (faq.body as { id: string }).id;
      itemsA.customAnswer = (customAnswer.body as { id: string }).id;
      itemsA.source = (source.body as { id: string; status: string }).id;
      expect((source.body as { status: string }).status).toBe('QUEUED');
    });

    it("lists show only the caller's items", async () => {
      expect(await listIds(cookies.ownerA, '/v1/faqs')).toContain(itemsA.faq);
      expect(await listIds(cookies.ownerB, '/v1/faqs')).toEqual([]);
      expect(await listIds(cookies.ownerB, '/v1/custom-answers')).toEqual([]);
      expect(await listIds(cookies.ownerB, '/v1/knowledge-sources')).toEqual(
        [],
      );
    });

    it("another workspace's items are a 404 for read, edit and delete", async () => {
      const b = as(cookies.ownerB);
      const p = paths();
      await b.get(p.source).expect(404);
      await b.patch(p.faq).send({ answer: 'Hijacked' }).expect(404);
      await b.patch(p.customAnswer).send({ answer: 'Hijacked' }).expect(404);
      await b.patch(p.source).send({ content: 'Hijacked' }).expect(404);
      await b.delete(p.faq).expect(404);
      await b.delete(p.customAnswer).expect(404);
      await b.delete(p.source).expect(404);

      const [faq, customAnswer, source] = await Promise.all([
        prisma.faq.findUniqueOrThrow({ where: { id: itemsA.faq } }),
        prisma.customAnswer.findUniqueOrThrow({
          where: { id: itemsA.customAnswer },
        }),
        prisma.knowledgeSource.findUniqueOrThrow({
          where: { id: itemsA.source },
        }),
      ]);
      expect(faq.answer).toBe('Yes.');
      expect(customAnswer.answer).toBe('Rina.');
      expect(source.content).toBe('30 days.');
    });

    it("reordering with another workspace's FAQ IDs is a 404", async () => {
      await as(cookies.ownerB)
        .put('/v1/faqs/order')
        .send({ ids: [itemsA.faq] })
        .expect(404);
    });

    it('the owner can edit, reorder and delete their own items', async () => {
      const owner = as(cookies.ownerA);
      const p = paths();
      await owner.patch(p.faq).send({ answer: 'Yes, worldwide.' }).expect(200);
      await owner.get(p.source).expect(200);

      const ids = await listIds(cookies.ownerA, '/v1/faqs');
      const reordered = await owner
        .put('/v1/faqs/order')
        .send({ ids: [...ids].reverse() })
        .expect(200);
      expect((reordered.body as { id: string }[]).map((f) => f.id)).toEqual(
        [...ids].reverse(),
      );

      await owner.delete(p.customAnswer).expect(204);
      expect(await listIds(cookies.ownerA, '/v1/custom-answers')).toEqual([]);
    });

    it('a viewer can read but not change knowledge (403)', async () => {
      const viewer = as(cookies.viewerA);
      await viewer.get('/v1/faqs').expect(200);
      await viewer
        .post('/v1/faqs')
        .send({ question: 'Q', answer: 'A' })
        .expect(403);
      await viewer.delete(paths().faq).expect(403);
      await viewer
        .post('/v1/custom-answers')
        .send({ triggerQuestion: 'Q', answer: 'A' })
        .expect(403);
      await viewer
        .post('/v1/knowledge-sources')
        .send({ type: 'TEXT', title: 'T', content: 'C' })
        .expect(403);
    });

    describe('automatic re-indexing (M2-13)', () => {
      const faqChunks = (faqId: string) =>
        prisma.$queryRaw<{ workspace_id: string; content: string }[]>`
          SELECT workspace_id::text, content FROM knowledge_chunks
          WHERE faq_id = ${faqId}::uuid`;
      const rowModel = (table: 'custom_answers' | 'products', id: string) =>
        table === 'custom_answers'
          ? prisma.customAnswer
              .findUniqueOrThrow({
                where: { id },
                select: { embeddingModel: true },
              })
              .then((r) => r.embeddingModel)
          : prisma.product
              .findUniqueOrThrow({
                where: { id },
                select: { embeddingModel: true },
              })
              .then((r) => r.embeddingModel);

      it("indexes an FAQ's latest text into its workspace's chunks", async () => {
        // Edited to "Yes, worldwide." by an earlier test; the edit re-queued it.
        const chunks = await waitUntil(
          'the edited FAQ to be indexed',
          async () => {
            const rows = await faqChunks(itemsA.faq);
            return rows.some((r) => r.content.includes('worldwide')) && rows;
          },
        );
        expect(chunks).toEqual([
          {
            workspace_id: ids.a,
            content: 'Do you ship abroad?\n\nYes, worldwide.',
          },
        ]);
      });

      it("B's search never finds A's FAQ", async () => {
        const knowledge = app.get(KnowledgeService);
        const inA = await inWorkspace(ids.a, () =>
          knowledge.search(ids.botA, 'do you ship abroad'),
        );
        expect(inA.map((m) => m.content)).toContain(
          'Do you ship abroad?\n\nYes, worldwide.',
        );
        await expect(
          inWorkspace(ids.b, () => knowledge.search(ids.botB, 'ship abroad')),
        ).resolves.toEqual([]);
      });

      it("embeds a custom answer's trigger question", async () => {
        const res = await as(cookies.ownerA)
          .post('/v1/custom-answers')
          .send({ triggerQuestion: 'Who founded the shop?', answer: 'Rina.' })
          .expect(201);
        const id = (res.body as { id: string }).id;

        await expect(
          waitUntil('the custom answer embedding', () =>
            rowModel('custom_answers', id),
          ),
        ).resolves.toBe(FAKE_EMBEDDING_MODEL);
        await as(cookies.ownerA).delete(`/v1/custom-answers/${id}`).expect(204);
      });

      it('deleting an FAQ deletes its chunks', async () => {
        const res = await as(cookies.ownerA)
          .post('/v1/faqs')
          .send({ question: 'Gift wrap?', answer: 'Yes, free.' })
          .expect(201);
        const id = (res.body as { id: string }).id;
        await waitUntil(
          'the new FAQ to be indexed',
          async () => (await faqChunks(id)).length > 0,
        );

        await as(cookies.ownerA).delete(`/v1/faqs/${id}`).expect(204);

        await expect(faqChunks(id)).resolves.toEqual([]);
      });

      it('embeds products', async () => {
        const res = await as(cookies.ownerA)
          .post('/v1/products')
          .send({ name: 'Rain boot', category: 'Footwear' })
          .expect(201);
        const id = (res.body as { id: string }).id;

        await expect(
          waitUntil('the product embedding', () => rowModel('products', id)),
        ).resolves.toBe(FAKE_EMBEDDING_MODEL);
        await as(cookies.ownerA).delete(`/v1/products/${id}`).expect(204);
      });
    });

    describe('document upload (M2-10, real MinIO)', () => {
      interface SourceBody {
        id: string;
        type: string;
        title: string;
        status: string;
        mimeType: string;
      }
      const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
      const upload = (cookie: string, file: Buffer, name: string) =>
        as(cookie)
          .post('/v1/knowledge-sources/upload')
          .attach('file', file, name);
      const fileExists = async (key: string) => {
        const s3 = app.get<S3Client>(S3_CLIENT);
        const Bucket = app
          .get(ConfigService)
          .getOrThrow<string>('storage.bucket');
        return s3.send(new HeadObjectCommand({ Bucket, Key: key })).then(
          () => true,
          () => false,
        );
      };
      let docA: SourceBody;
      let keyA: string;

      beforeAll(async () => {
        const res = await upload(cookies.ownerA, PDF, 'Return policy.pdf')
          .field('title', 'Returns')
          .expect(202);
        docA = res.body as SourceBody;
        keyA = (
          await prisma.knowledgeSource.findUniqueOrThrow({
            where: { id: docA.id },
          })
        ).fileKey!;
      });

      it("stores the file under the caller's workspace and queues it", async () => {
        expect(docA).toMatchObject({
          type: 'DOCUMENT',
          title: 'Returns',
          status: 'QUEUED',
          mimeType: 'application/pdf',
        });
        expect(keyA.startsWith(`workspaces/${ids.a}/documents/`)).toBe(true);
        expect(await fileExists(keyA)).toBe(true);
      });

      it("another workspace can't see or delete the document (404)", async () => {
        const b = as(cookies.ownerB);
        await b.get(`/v1/knowledge-sources/${docA.id}`).expect(404);
        await b.delete(`/v1/knowledge-sources/${docA.id}`).expect(404);
        const list = (
          await b.get('/v1/knowledge-sources?type=DOCUMENT').expect(200)
        ).body as SourceBody[];
        expect(list).toEqual([]);
        expect(await fileExists(keyA)).toBe(true);
      });

      it('rejects a file whose content is not what its name says (400)', async () => {
        await upload(
          cookies.ownerA,
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
          'cat.pdf',
        ).expect(400);
        await as(cookies.ownerA)
          .post('/v1/knowledge-sources/upload')
          .expect(400);
      });

      it('is a 413 for a document over 10 MB', async () => {
        await upload(
          cookies.ownerA,
          Buffer.alloc(10 * 1024 * 1024 + 1, 'a'),
          'big.txt',
        ).expect(413);
      });

      it('a viewer cannot upload (403)', async () => {
        await upload(cookies.viewerA, PDF, 'x.pdf').expect(403);
      });

      describe('indexing (M2-11, M2-12)', () => {
        let txtA: SourceBody;
        const chunksOf = (sourceId: string) =>
          prisma.$queryRaw<
            {
              workspace_id: string;
              chatbot_id: string;
              content: string;
              embedding_model: string;
            }[]
          >`SELECT workspace_id::text, chatbot_id::text, content, embedding_model
            FROM knowledge_chunks WHERE source_id = ${sourceId}::uuid`;

        beforeAll(async () => {
          const res = await upload(
            cookies.ownerA,
            Buffer.from('# Shipping\n\nWe ship to Dhaka within 2 days.'),
            'shipping.md',
          ).expect(202);
          txtA = res.body as SourceBody;
        });

        it('indexes an upload into chunks owned by its workspace and chatbot', async () => {
          await waitForStatus(cookies.ownerA, txtA.id, 'READY');

          const chunks = await chunksOf(txtA.id);
          expect(chunks).toEqual([
            {
              workspace_id: ids.a,
              chatbot_id: ids.botA,
              content: 'Shipping\nWe ship to Dhaka within 2 days.',
              embedding_model: FAKE_EMBEDDING_MODEL,
            },
          ]);
          const detail = (
            await as(cookies.ownerA)
              .get(`/v1/knowledge-sources/${txtA.id}`)
              .expect(200)
          ).body as { content: string };
          expect(detail.content).toContain('We ship to Dhaka');
        });

        it("search finds only the caller's chunks", async () => {
          const knowledge = app.get(KnowledgeService);
          const inA = await inWorkspace(ids.a, () =>
            knowledge.search(ids.botA, 'shipping to Dhaka'),
          );
          expect(inA.map((m) => m.content)).toContain(
            'Shipping\nWe ship to Dhaka within 2 days.',
          );
          // B asking about A's chatbot, or its own: nothing of A's.
          await expect(
            inWorkspace(ids.b, () => knowledge.search(ids.botA, 'shipping')),
          ).resolves.toEqual([]);
          await expect(
            inWorkspace(ids.b, () => knowledge.search(ids.botB, 'shipping')),
          ).resolves.toEqual([]);
          await expect(
            inWorkspace(ids.b, () => db.knowledgeChunk.findMany()),
          ).resolves.toEqual([]);
        });

        it('marks an unreadable PDF FAILED with a readable reason', async () => {
          const failed = await waitForStatus(cookies.ownerA, docA.id, 'FAILED');
          expect(failed.error).toMatch(/PDF/);
        });

        it("another workspace can't reindex the source (404); the owner can", async () => {
          await as(cookies.ownerB)
            .post(`/v1/knowledge-sources/${docA.id}/reindex`)
            .expect(404);
          const res = await as(cookies.ownerA)
            .post(`/v1/knowledge-sources/${docA.id}/reindex`)
            .expect(202);
          expect((res.body as SourceBody).status).toBe('QUEUED');
          await waitForStatus(cookies.ownerA, docA.id, 'FAILED');
        });

        it('deleting a source deletes its chunks', async () => {
          await as(cookies.ownerA)
            .delete(`/v1/knowledge-sources/${txtA.id}`)
            .expect(204);
          await expect(chunksOf(txtA.id)).resolves.toEqual([]);
        });
      });

      it('deleting the document deletes its file', async () => {
        await as(cookies.ownerA)
          .delete(`/v1/knowledge-sources/${docA.id}`)
          .expect(204);
        expect(await fileExists(keyA)).toBe(false);
      });
    });
  });

  describe('LLM keys (M3-21)', () => {
    interface KeyBody {
      id: string;
      provider: string;
      keyLast4: string;
      isActive: boolean;
    }
    let keyA = '';

    beforeAll(async () => {
      const res = await as(cookies.ownerA)
        .post('/v1/llm-keys')
        .send({ provider: 'gemini', model: 'g-x', apiKey: 'AIza-secret-A111' })
        .expect(201);
      keyA = (res.body as KeyBody).id;
    });

    it('never returns the key, only its last 4 characters', async () => {
      const res = await as(cookies.ownerA).get('/v1/llm-keys').expect(200);
      const mine = (res.body as KeyBody[]).find((k) => k.id === keyA);
      expect(mine).toMatchObject({ provider: 'gemini', keyLast4: 'A111' });
      expect(JSON.stringify(res.body)).not.toContain('AIza-secret');
    });

    it('stores the key encrypted in its own workspace', async () => {
      const row = await prisma.workspaceLlmKey.findUniqueOrThrow({
        where: { id: keyA },
      });
      expect(row.workspaceId).toBe(ids.a);
      expect(row.apiKeyEncrypted).not.toContain('AIza-secret');
    });

    it("another workspace can't see, change or delete it (404)", async () => {
      const list = await as(cookies.ownerB).get('/v1/llm-keys').expect(200);
      expect((list.body as KeyBody[]).map((k) => k.id)).not.toContain(keyA);
      await as(cookies.ownerB)
        .patch(`/v1/llm-keys/${keyA}`)
        .send({ isActive: false })
        .expect(404);
      await as(cookies.ownerB).delete(`/v1/llm-keys/${keyA}`).expect(404);
      expect(
        await inWorkspace(ids.b, () =>
          db.workspaceLlmKey.findUnique({ where: { id: keyA } }),
        ),
      ).toBeNull();
    });

    it('only the owner can manage keys (403 for a viewer)', async () => {
      await as(cookies.viewerA).get('/v1/llm-keys').expect(403);
      await as(cookies.viewerA)
        .post('/v1/llm-keys')
        .send({ provider: 'openai', model: 'm', apiKey: 'sk-viewer-key' })
        .expect(403);
    });

    it('rejects a provider outside OpenAI, Gemini and Groq (400)', async () => {
      await as(cookies.ownerA)
        .post('/v1/llm-keys')
        .send({ provider: 'anthropic', model: 'm', apiKey: 'sk-ant-12345' })
        .expect(400);
    });

    it('the owner can switch the key off and delete it', async () => {
      const res = await as(cookies.ownerA)
        .patch(`/v1/llm-keys/${keyA}`)
        .send({ isActive: false })
        .expect(200);
      expect((res.body as KeyBody).isActive).toBe(false);
      await as(cookies.ownerA).delete(`/v1/llm-keys/${keyA}`).expect(204);
      await as(cookies.ownerA).delete(`/v1/llm-keys/${keyA}`).expect(404);
    });
  });

  describe('Preview chat (M3-13, M3-14)', () => {
    const sentToLlm = () =>
      JSON.stringify(fakeLlm.streamWith.mock.calls.at(-1)?.[1] ?? []);
    const keysSent = () =>
      (fakeLlm.streamWith.mock.calls.at(-1)?.[0] ?? []) as {
        apiKey: string;
      }[];

    beforeAll(async () => {
      // Chat runs on each workspace's own key (M3-21).
      await as(cookies.ownerA)
        .post('/v1/llm-keys')
        .send({ provider: 'openai', model: 'gpt-x', apiKey: 'sk-preview-a' })
        .expect(201);
      await as(cookies.ownerB)
        .post('/v1/llm-keys')
        .send({ provider: 'groq', model: 'llama-x', apiKey: 'gsk-preview-b' })
        .expect(201);

      const a = await as(cookies.ownerA)
        .post('/v1/knowledge-sources')
        .send({
          type: 'POLICY',
          title: 'Preview A hours',
          content: 'We open at 9am.',
        })
        .expect(201);
      const b = await as(cookies.ownerB)
        .post('/v1/knowledge-sources')
        .send({
          type: 'POLICY',
          title: 'Preview B secret',
          content: 'The warehouse code is B-7781.',
        })
        .expect(201);
      await waitForStatus(
        cookies.ownerA,
        (a.body as { id: string }).id,
        'READY',
      );
      await waitForStatus(
        cookies.ownerB,
        (b.body as { id: string }).id,
        'READY',
      );
    });

    it("answers from the caller's knowledge only, never another workspace's", async () => {
      const res = await as(cookies.ownerA)
        .post('/v1/chatbot/preview/messages')
        .send({ message: 'What is the warehouse code?' })
        .expect(200);
      const out = chatEvents(res);
      expect(out.reply).toBe('stub answer');
      expect(out.done).toMatchObject({ answeredBy: 'llm' });
      // A has other items from earlier tests, so which of A's chunks rank
      // first depends on the fake embedding; B's must never appear.
      const titles = out.sources.map((s) => s.title);
      expect(titles.length).toBeGreaterThan(0);
      expect(titles).not.toContain('Preview B secret');
      expect(sentToLlm()).not.toContain('B-7781');
      expect(keysSent().map((k) => k.apiKey)).toEqual(['sk-preview-a']);
    });

    it("B's preview finds B's knowledge, not A's", async () => {
      const res = await as(cookies.ownerB)
        .post('/v1/chatbot/preview/messages')
        .send({ message: 'When do you open?' })
        .expect(200);
      const titles = chatEvents(res).sources.map((s) => s.title);
      expect(titles).toContain('Preview B secret');
      expect(titles).not.toContain('Preview A hours');
      expect(sentToLlm()).not.toContain('We open at 9am.');
      expect(keysSent().map((k) => k.apiKey)).toEqual(['gsk-preview-b']);
    });

    it("stores each turn in the caller's own workspace, with how it was answered (M3-5, M3-11)", async () => {
      const first = await as(cookies.ownerA)
        .post('/v1/chatbot/preview/messages')
        .send({ message: 'What time do you open?' })
        .expect(200);
      const conversationId = chatEvents(first).conversationId as string;
      expect(conversationId).toEqual(expect.any(String));

      const second = await as(cookies.ownerA)
        .post('/v1/chatbot/preview/messages')
        .send({ message: 'And on Sunday?', conversationId })
        .expect(200);
      expect(chatEvents(second).conversationId).toBe(conversationId);
      // The second turn was answered from the stored first one.
      const sent = JSON.stringify(fakeLlm.streamWith.mock.calls.at(-1)?.[1]);
      expect(sent).toContain('What time do you open?');
      expect(sent).toContain('stub answer');

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      expect(conversation).toMatchObject({
        workspaceId: ids.a,
        chatbotId: ids.botA,
        isPreview: true,
        messageCount: 4,
      });
      expect(conversation.messages.map((m) => m.role)).toEqual([
        'USER',
        'ASSISTANT',
        'USER',
        'ASSISTANT',
      ]);
      expect(new Set(conversation.messages.map((m) => m.workspaceId))).toEqual(
        new Set([ids.a]),
      );
      expect(conversation.messages[1]).toMatchObject({
        answeredBy: 'llm',
        model: 'stub-model',
        tokensIn: 100,
        tokensOut: 7,
      });
    });

    it("another workspace can't see or continue the conversation", async () => {
      const first = await as(cookies.ownerA)
        .post('/v1/chatbot/preview/messages')
        .send({ message: 'Private question' })
        .expect(200);
      const conversationId = chatEvents(first).conversationId as string;

      await expect(
        inWorkspace(ids.b, () =>
          db.conversation.findUnique({ where: { id: conversationId } }),
        ),
      ).resolves.toBeNull();
      await expect(
        inWorkspace(ids.b, () =>
          db.message.findMany({ where: { conversationId } }),
        ),
      ).resolves.toEqual([]);

      // B naming A's conversation ID starts B's own conversation instead.
      const res = await as(cookies.ownerB)
        .post('/v1/chatbot/preview/messages')
        .send({ message: 'Hello', conversationId })
        .expect(200);
      const bId = chatEvents(res).conversationId as string;
      expect(bId).not.toBe(conversationId);
      const untouched = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      expect(untouched.workspaceId).toBe(ids.a);
      expect(untouched.messageCount).toBe(2);
      const mine = await prisma.conversation.findUniqueOrThrow({
        where: { id: bId },
      });
      expect(mine.workspaceId).toBe(ids.b);
    });

    it('is off in a workspace without its own key, with no LLM call', async () => {
      const calls = fakeLlm.streamWith.mock.calls.length;
      const a2 = await login(users.ownerA, ids.a2);
      const res = await as(a2)
        .post('/v1/chatbot/preview/messages')
        .send({ message: 'Hi' })
        .expect(200);
      expect(chatEvents(res).reply).toMatch(/add your own LLM API key/);
      expect(fakeLlm.streamWith.mock.calls.length).toBe(calls);
    });

    it('a viewer can use the preview', async () => {
      await as(cookies.viewerA)
        .post('/v1/chatbot/preview/messages')
        .send({ message: 'Hi' })
        .expect(200);
    });

    it('rejects an empty message (400) and no session (401)', async () => {
      await as(cookies.ownerA)
        .post('/v1/chatbot/preview/messages')
        .send({ message: '   ' })
        .expect(400);
      await request(http)
        .post('/v1/chatbot/preview/messages')
        .set('X-Requested-With', 'fetch')
        .send({ message: 'Hi' })
        .expect(401);
    });
  });

  // After the preview tests: B gets chunks of its own here, and the
  // earlier tests expect B to have none.
  describe('Hybrid retrieval (M3-7)', () => {
    it("keyword search finds an exact code, and only in the caller's own workspace (M3-7)", async () => {
      const knowledge = app.get(KnowledgeService);
      const make = async (cookie: string, title: string, content: string) => {
        const res = await as(cookie)
          .post('/v1/knowledge-sources')
          .send({ type: 'POLICY', title, content })
          .expect(201);
        await waitForStatus(cookie, (res.body as { id: string }).id, 'READY');
      };
      await make(
        cookies.ownerA,
        'Hybrid A',
        'Your claim reference is QXZK4410 for all repairs.',
      );
      await make(
        cookies.ownerB,
        'Hybrid B',
        'Your claim reference is QXZK9999 for all repairs.',
      );

      const inA = await inWorkspace(ids.a, () =>
        knowledge.search(ids.botA, 'QXZK4410', 5),
      );
      expect(inA[0].content).toContain('QXZK4410');
      expect(inA.map((m) => m.content).join(' ')).not.toContain('QXZK9999');

      // The other workspace's code is a keyword A can type, and still isn't found.
      const stolen = await inWorkspace(ids.a, () =>
        knowledge.search(ids.botA, 'QXZK9999', 5),
      );
      expect(stolen.map((m) => m.content).join(' ')).not.toContain('QXZK9999');

      const inB = await inWorkspace(ids.b, () =>
        knowledge.search(ids.botB, 'QXZK9999', 5),
      );
      expect(inB[0].content).toContain('QXZK9999');
      expect(inB.map((m) => m.content).join(' ')).not.toContain('QXZK4410');
    });
  });

  describe('Public widget chat (early MVP)', () => {
    const publicIdOf = async (id: string) =>
      (
        await prisma.chatbot.findUniqueOrThrow({
          where: { id },
          select: { publicId: true },
        })
      ).publicId;
    const visitor = (publicId: string) => ({
      config: () => request(http).get(`/v1/public/chatbots/${publicId}/config`),
      send: (message: string) =>
        request(http)
          .post(`/v1/public/chatbots/${publicId}/messages`)
          .set('X-Requested-With', 'fetch')
          .send({ message }),
    });
    const lastCall = () => fakeLlm.streamWith.mock.calls.at(-1) ?? [];

    // A was published by the Chatbot API tests and has a key and a policy
    // from the preview tests; B has never been published.
    it("answers without a login, from the chatbot's own workspace and key", async () => {
      const a = visitor(await publicIdOf(ids.botA));
      await a.config().expect(200);
      const res = await a.send('What is the warehouse code?').expect(200);
      const out = chatEvents(res);
      expect(out.reply).toBe('stub answer');
      expect(out.conversationId).toEqual(expect.any(String));
      // Visitors never get the knowledge sources (dashboard only).
      expect(out.events.map((e) => e.type)).not.toContain('sources');
      const [keys, messages] = lastCall() as [{ apiKey: string }[], unknown];
      expect(keys.map((k) => k.apiKey)).toEqual(['sk-preview-a']);
      expect(JSON.stringify(messages)).not.toContain('B-7781');
    });

    it("stores a visitor's chat in the chatbot's workspace and continues it for the same visitor only", async () => {
      const publicId = await publicIdOf(ids.botA);
      const send = (body: object) =>
        request(http)
          .post(`/v1/public/chatbots/${publicId}/messages`)
          .set('X-Requested-With', 'fetch')
          .send(body);

      const first = await send({
        message: 'Hi there',
        visitorId: 'visitor_abc12345',
      }).expect(200);
      const conversationId = chatEvents(first).conversationId as string;
      const again = await send({
        message: 'One more thing',
        visitorId: 'visitor_abc12345',
        conversationId,
      }).expect(200);
      expect(chatEvents(again).conversationId).toBe(conversationId);
      const stored = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversationId },
      });
      expect(stored).toMatchObject({
        workspaceId: ids.a,
        chatbotId: ids.botA,
        isPreview: false,
        visitorId: 'visitor_abc12345',
        messageCount: 4,
      });
      expect(stored.versionId).toEqual(expect.any(String));

      // Another visitor naming the same ID gets a conversation of their own.
      const other = await send({
        message: 'Hello',
        visitorId: 'visitor_other999',
        conversationId,
      }).expect(200);
      expect(chatEvents(other).conversationId).not.toBe(conversationId);
    });

    it('is a 404 for an unpublished, switched-off or unknown chatbot', async () => {
      const b = visitor(await publicIdOf(ids.botB));
      await b.config().expect(404);
      await b.send('Hi').expect(404);
      await visitor('cb_doesnotexist').send('Hi').expect(404);

      await as(cookies.ownerA)
        .patch('/v1/chatbot/status')
        .send({ status: 'DISABLED' })
        .expect(200);
      try {
        await visitor(await publicIdOf(ids.botA))
          .send('Hi')
          .expect(404);
      } finally {
        await as(cookies.ownerA)
          .patch('/v1/chatbot/status')
          .send({ status: 'ENABLED' })
          .expect(200);
      }
    });

    it('rejects an empty message (400)', async () => {
      await visitor(await publicIdOf(ids.botA))
        .send('  ')
        .expect(400);
    });
  });

  describe('Products API (M2-21)', () => {
    interface ProductBody {
      id: string;
      name: string;
      sku: string | null;
      price: string | null;
      currency: string;
    }
    interface Page {
      items: ProductBody[];
      nextCursor: string | null;
    }
    let productA: ProductBody;

    beforeAll(async () => {
      const res = await as(cookies.ownerA)
        .post('/v1/products')
        .send({ name: 'Trail shoe', sku: 'SKU-1', price: '49.9' })
        .expect(201);
      productA = res.body as ProductBody;
    });

    it("stores money as a string and uses the chatbot's currency", () => {
      expect(productA.price).toBe('49.90');
      expect(productA.currency).toBe('USD');
    });

    it("lists and searches only the caller's products", async () => {
      const a = (await as(cookies.ownerA).get('/v1/products').expect(200))
        .body as Page;
      expect(a.items.map((p) => p.id)).toContain(productA.id);

      const b = (
        await as(cookies.ownerB).get('/v1/products?q=trail').expect(200)
      ).body as Page;
      expect(b.items).toEqual([]);
    });

    it("another workspace's product is a 404 for edit and delete", async () => {
      const b = as(cookies.ownerB);
      await b
        .patch(`/v1/products/${productA.id}`)
        .send({ price: '1' })
        .expect(404);
      await b.delete(`/v1/products/${productA.id}`).expect(404);

      const row = await prisma.product.findUniqueOrThrow({
        where: { id: productA.id },
      });
      expect(row.price?.toFixed(2)).toBe('49.90');
    });

    it('SKUs are unique per chatbot, not across workspaces', async () => {
      await as(cookies.ownerA)
        .post('/v1/products')
        .send({ name: 'Copy', sku: 'SKU-1' })
        .expect(409);
      const res = await as(cookies.ownerB)
        .post('/v1/products')
        .send({ name: 'Other shop shoe', sku: 'SKU-1' })
        .expect(201);
      await as(cookies.ownerB)
        .delete(`/v1/products/${(res.body as ProductBody).id}`)
        .expect(204);
    });

    it("pages through the caller's products with a cursor", async () => {
      const owner = as(cookies.ownerA);
      for (const name of ['Sandal', 'Boot']) {
        await owner.post('/v1/products').send({ name }).expect(201);
      }

      const first = (await owner.get('/v1/products?limit=2').expect(200))
        .body as Page;
      expect(first.items.map((p) => p.name)).toEqual(['Boot', 'Sandal']);
      expect(first.nextCursor).not.toBeNull();

      const second = (
        await owner
          .get(`/v1/products?limit=2&cursor=${first.nextCursor}`)
          .expect(200)
      ).body as Page;
      expect(second.items.map((p) => p.name)).toEqual(['Trail shoe']);
      expect(second.nextCursor).toBeNull();

      // A's cursor in B's hands only pages through B's (empty) list.
      const b = (
        await as(cookies.ownerB)
          .get(`/v1/products?cursor=${first.nextCursor}`)
          .expect(200)
      ).body as Page;
      expect(b.items).toEqual([]);
    });

    it('a viewer can read products but not change them (403)', async () => {
      const viewer = as(cookies.viewerA);
      await viewer.get('/v1/products').expect(200);
      await viewer.post('/v1/products').send({ name: 'X' }).expect(403);
      await viewer
        .patch(`/v1/products/${productA.id}`)
        .send({ name: 'X' })
        .expect(403);
      await viewer.delete(`/v1/products/${productA.id}`).expect(403);
    });

    describe('CSV import (M2-8)', () => {
      interface ImportBody {
        created: number;
        updated: number;
        failed: number;
        errors: { row: number; message: string }[];
      }
      const upload = (cookie: string, ...lines: string[]) =>
        as(cookie)
          .post('/v1/products/import')
          .attach('file', Buffer.from(lines.join('\n')), 'products.csv');

      it("importing another workspace's SKU creates the caller's own product", async () => {
        const res = await upload(
          cookies.ownerB,
          'sku,name,price',
          'SKU-1,Other shop shoe,5',
        ).expect(200);
        expect(res.body).toEqual({
          created: 1,
          updated: 0,
          failed: 0,
          errors: [],
        });

        const a = await prisma.product.findUniqueOrThrow({
          where: { id: productA.id },
        });
        expect(a.name).toBe('Trail shoe');
        expect(a.price?.toFixed(2)).toBe('49.90');

        // Later tests expect B to have no products.
        await prisma.product.deleteMany({ where: { workspaceId: ids.b } });
      });

      it('updates by SKU, creates new rows and reports bad ones', async () => {
        const res = await upload(
          cookies.ownerA,
          'sku,name,price',
          'SKU-1,Trail shoe v2,59',
          'SKU-9,Socks,3',
          'SKU-10,,1',
        ).expect(200);
        const body = res.body as ImportBody;
        expect(body).toMatchObject({ created: 1, updated: 1, failed: 1 });
        expect(body.errors.map((e) => e.row)).toEqual([4]);

        const updated = await prisma.product.findUniqueOrThrow({
          where: { id: productA.id },
        });
        expect(updated.name).toBe('Trail shoe v2');
        expect(updated.isActive).toBe(true);
      });

      it('is a 400 without a file or with unknown columns', async () => {
        await as(cookies.ownerA).post('/v1/products/import').expect(400);
        await upload(cookies.ownerA, 'name,colour', 'Shoe,red').expect(400);
      });

      it('is a 413 for a file over 1 MB', async () => {
        await as(cookies.ownerA)
          .post('/v1/products/import')
          .attach('file', Buffer.alloc(1024 * 1024 + 1, 'a'), 'big.csv')
          .expect(413);
      });

      it('a viewer can download the template but not import (403)', async () => {
        const viewer = as(cookies.viewerA);
        const res = await viewer
          .get('/v1/products/import/template.csv')
          .expect(200)
          .expect('Content-Type', /text\/csv/);
        expect(res.text.split('\r\n')[0]).toBe(
          'sku,name,description,price,compare_at_price,currency,stock_status,stock_quantity,category,url,image_url',
        );
        await upload(cookies.viewerA, 'name', 'Shoe').expect(403);
      });
    });
  });

  describe('tenant Prisma client', () => {
    it('lists only the current workspace', async () => {
      const bots = await inWorkspace(ids.a, () => db.chatbot.findMany());
      expect(bots.map((b) => b.id)).toEqual([ids.botA]);

      const members = await inWorkspace(ids.a, () =>
        db.workspaceMember.findMany(),
      );
      expect(new Set(members.map((m) => m.workspaceId))).toEqual(
        new Set([ids.a]),
      );
    });

    it("can't find another workspace's row by id", async () => {
      await expect(
        inWorkspace(ids.a, () =>
          db.chatbot.findUnique({ where: { id: ids.botB } }),
        ),
      ).resolves.toBeNull();
      await expect(
        inWorkspace(ids.a, () =>
          db.chatbot.findFirst({ where: { id: ids.botB } }),
        ),
      ).resolves.toBeNull();
      await expect(
        inWorkspace(ids.a, () =>
          db.workspace.findUnique({ where: { id: ids.b } }),
        ),
      ).resolves.toBeNull();
    });

    it("can't see another workspace's knowledge", async () => {
      // Runs after the Knowledge base API tests, so A has FAQs and a policy.
      const [faqA, sourceA] = await Promise.all([
        prisma.faq.findFirstOrThrow({ where: { workspaceId: ids.a } }),
        prisma.knowledgeSource.findFirstOrThrow({
          where: { workspaceId: ids.a },
        }),
      ]);
      await expect(
        inWorkspace(ids.b, () => db.faq.findMany()),
      ).resolves.toEqual([]);
      await expect(
        inWorkspace(ids.b, () => db.customAnswer.findMany()),
      ).resolves.toEqual([]);
      await expect(
        inWorkspace(ids.b, () => db.faq.findUnique({ where: { id: faqA.id } })),
      ).resolves.toBeNull();
      await expect(
        inWorkspace(ids.b, () =>
          db.knowledgeSource.deleteMany({ where: { id: sourceA.id } }),
        ),
      ).resolves.toEqual({ count: 0 });
    });

    it("can't see another workspace's products", async () => {
      // Runs after the Products API tests, so A has products.
      const productA = await prisma.product.findFirstOrThrow({
        where: { workspaceId: ids.a },
      });
      await expect(
        inWorkspace(ids.b, () => db.product.findMany()),
      ).resolves.toEqual([]);
      await expect(
        inWorkspace(ids.b, () =>
          db.product.updateMany({
            where: { id: productA.id },
            data: { name: 'hijacked' },
          }),
        ),
      ).resolves.toEqual({ count: 0 });
    });

    it("can't see another workspace's chatbot versions", async () => {
      // Runs after the Chatbot API tests, so A has a published version.
      const versionA = await prisma.chatbotVersion.findFirstOrThrow({
        where: { workspaceId: ids.a },
      });
      await expect(
        inWorkspace(ids.b, () => db.chatbotVersion.findMany()),
      ).resolves.toEqual([]);
      await expect(
        inWorkspace(ids.b, () =>
          db.chatbotVersion.findUnique({ where: { id: versionA.id } }),
        ),
      ).resolves.toBeNull();
      await expect(
        inWorkspace(ids.b, () =>
          db.chatbotVersion.deleteMany({ where: { id: versionA.id } }),
        ),
      ).resolves.toEqual({ count: 0 });
    });

    it("counts only the current workspace's rows", async () => {
      await expect(inWorkspace(ids.a, () => db.chatbot.count())).resolves.toBe(
        1,
      );
    });

    it("can't update or delete another workspace's row", async () => {
      await expect(
        inWorkspace(ids.a, () =>
          db.chatbot.update({
            where: { id: ids.botB },
            data: { status: 'DISABLED' },
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2025' });
      await expect(
        inWorkspace(ids.a, () =>
          db.chatbot.deleteMany({ where: { id: ids.botB } }),
        ),
      ).resolves.toEqual({ count: 0 });
      await expect(
        inWorkspace(ids.a, () =>
          db.workspace.update({
            where: { id: ids.b },
            data: { name: 'hijacked' },
          }),
        ),
      ).rejects.toMatchObject({ code: 'P2025' });

      const botB = await prisma.chatbot.findUniqueOrThrow({
        where: { id: ids.botB },
      });
      expect(botB.status).toBe('ENABLED');
    });

    it('creates land in the current workspace even if another is named', async () => {
      const bot = await inWorkspace(ids.a, () =>
        db.chatbot.create({
          data: {
            publicId: `cb_iso${run}`,
            draftConfig: {},
            workspaceId: ids.b,
          },
        }),
      );
      expect(bot.workspaceId).toBe(ids.a);
      await prisma.chatbot.delete({ where: { id: bot.id } });
    });

    it('refuses to run outside a workspace request', async () => {
      await expect(db.chatbot.findMany()).rejects.toThrow(
        'outside a workspace request',
      );
    });

    it('fails closed when a query built in one context runs outside it', async () => {
      // Built inside A's context but only awaited afterwards: the query
      // checks the context when it actually runs, finds none, and refuses
      // rather than returning unscoped rows.
      const lazy = runWithTenant(
        { workspaceId: ids.a, userId: 'test', role: WorkspaceRole.OWNER },
        () => db.chatbot.findMany(),
      );
      await expect(lazy).rejects.toThrow('outside a workspace request');
    });

    it('refuses platform models', async () => {
      await expect(
        inWorkspace(ids.a, () => db.user.findMany()),
      ).rejects.toThrow('not tenant data');
    });
  });
});
