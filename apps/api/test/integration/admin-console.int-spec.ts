import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaClient } from '../../src/generated/prisma/client';
import { createAdminPrisma } from './admin-prisma';
import { SESSION_COOKIE } from '../../src/modules/auth/auth.constants';
import { SessionsService } from '../../src/modules/auth/sessions.service';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { WidgetFiles } from '../../src/modules/widget-page/widget-files';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { fakeEmbeddingService } from './fake-embedding';

interface UserBody {
  items: {
    id: string;
    email: string;
    isPlatformAdmin: boolean;
    emailVerifiedAt: string | null;
    workspaces: { id: string; role: string }[];
  }[];
  nextCursor: string | null;
}

/**
 * M7-35: users (list, manual email verification, platform-admin access),
 * the read-only support view and workspace deletion. Who can reach them
 * (platform admins only, everyone else gets a 404), what they change, and
 * that every use is audited. Runs on real Postgres.
 */
describe('Platform admin console: users, support view, delete (M7-35)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (who: string) => `adc-${run}-${who}@example.test`.toLowerCase();
  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaClient;
  let dist: string;
  const ids = { a: '', b: '', adminWs: '', botA: '', botB: '' };
  const publicIds = { a: '', b: '' };
  const userIds = { admin: '', ownerA: '', ownerB: '', fresh: '' };
  const cookies = { admin: '', ownerA: '', ownerB: '', fresh: '' };

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
    delete: (path: string) =>
      request(http)
        .delete(path)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
  });

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'widget-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><html></html>');
    writeFileSync(join(dist, 'chatbot.js'), '(function(){})();');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmbeddingService)
      .useValue(fakeEmbeddingService)
      .overrideProvider(WidgetFiles)
      .useValue(
        new WidgetFiles({
          get: (key: string) =>
            key === 'widget.distDir' ? dist : 'development',
        } as unknown as ConfigService),
      )
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = createAdminPrisma();

    const workspaces = app.get(WorkspacesService);
    const sessions = app.get(SessionsService);
    for (const who of ['admin', 'ownerA', 'ownerB', 'fresh'] as const) {
      const user = await prisma.user.create({
        data: {
          email: email(who),
          name: who,
          passwordHash: 'not-used',
          isPlatformAdmin: who === 'admin',
          // `fresh` stays unverified: the support case for manual verify.
          emailVerifiedAt: who === 'fresh' ? null : new Date(),
        },
      });
      userIds[who] = user.id;
    }
    const adminWs = await workspaces.createWithOwner({
      name: `Adc Own ${run}`,
      ownerUserId: userIds.admin,
    });
    const a = await workspaces.createWithOwner({
      name: `Adc Alpha ${run}`,
      ownerUserId: userIds.ownerA,
    });
    const b = await workspaces.createWithOwner({
      name: `Adc Bravo ${run}`,
      ownerUserId: userIds.ownerB,
    });
    const fresh = await workspaces.createWithOwner({
      name: `Adc Fresh ${run}`,
      ownerUserId: userIds.fresh,
    });
    Object.assign(ids, {
      a: a.id,
      b: b.id,
      adminWs: adminWs.id,
      botA: a.chatbots[0].id,
      botB: b.chatbots[0].id,
      fresh: fresh.id,
    });
    publicIds.a = a.chatbots[0].publicId;
    publicIds.b = b.chatbots[0].publicId;
    await prisma.faq.create({
      data: {
        workspaceId: ids.a,
        chatbotId: ids.botA,
        question: `Alpha question ${run}`,
        answer: 'Alpha answer',
      },
    });
    await prisma.faq.create({
      data: {
        workspaceId: ids.b,
        chatbotId: ids.botB,
        question: `Bravo question ${run}`,
        answer: 'Bravo answer',
      },
    });
    // Message content that the console must never expose.
    const conversation = await prisma.conversation.create({
      data: {
        workspaceId: ids.b,
        chatbotId: ids.botB,
        visitorId: `v-${run}`,
      },
    });
    await prisma.message.create({
      data: {
        workspaceId: ids.b,
        conversationId: conversation.id,
        role: 'USER',
        content: `private visitor words ${run}`,
      },
    });
    await prisma.knowledgeSource.create({
      data: {
        workspaceId: ids.b,
        chatbotId: ids.botB,
        type: 'DOCUMENT',
        title: 'Brochure',
        fileKey: `workspaces/${ids.b}/documents/${randomUUID()}/brochure.pdf`,
        fileName: 'brochure.pdf',
      },
    });

    const login = async (userId: string, workspaceId: string) =>
      `${SESSION_COOKIE}=${
        (await sessions.create({ userId, activeWorkspaceId: workspaceId }))
          .token
      }`;
    cookies.admin = await login(userIds.admin, adminWs.id);
    cookies.ownerA = await login(userIds.ownerA, ids.a);
    cookies.ownerB = await login(userIds.ownerB, ids.b);
    cookies.fresh = await login(userIds.fresh, fresh.id);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: { actorEmail: { startsWith: `adc-${run}-` } },
      });
      await prisma.workspace.deleteMany({
        where: { name: { endsWith: ` ${run}` } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: `adc-${run}-` } },
      });
    }
    await app?.close();
    await prisma?.$disconnect();
    rmSync(dist, { recursive: true, force: true });
  });

  describe('who can reach the new endpoints', () => {
    it('answers 404 to a workspace owner and changes nothing', async () => {
      const owner = as(cookies.ownerA);
      await owner.get('/v1/admin/users').expect(404);
      await owner.get(`/v1/admin/workspaces/${ids.b}/support-view`).expect(404);
      await owner
        .post(`/v1/admin/users/${userIds.fresh}/verify-email`)
        .expect(404);
      await owner
        .patch(`/v1/admin/users/${userIds.ownerA}`)
        .send({ isPlatformAdmin: true })
        .expect(404);
      await owner
        .delete(`/v1/admin/workspaces/${ids.b}`)
        .send({ confirmSlug: 'whatever' })
        .expect(404);

      const [user, workspace, fresh] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: userIds.ownerA } }),
        prisma.workspace.findUnique({ where: { id: ids.b } }),
        prisma.user.findUniqueOrThrow({ where: { id: userIds.fresh } }),
      ]);
      expect(user.isPlatformAdmin).toBe(false);
      expect(workspace).not.toBeNull();
      expect(fresh.emailVerifiedAt).toBeNull();
      expect(
        await prisma.auditLog.count({
          where: { actorUserId: userIds.ownerA },
        }),
      ).toBe(0);
    });

    it('answers 401 without a session', async () => {
      await request(http).get('/v1/admin/users').expect(401);
    });
  });

  describe('users', () => {
    it('lists accounts with their workspaces and never a password hash', async () => {
      const res = await as(cookies.admin)
        .get(`/v1/admin/users?q=adc-${run}-ownerA`)
        .expect(200);
      const body = res.body as UserBody;
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        email: email('ownera'),
        isPlatformAdmin: false,
        workspaces: [{ id: ids.a, role: 'OWNER' }],
      });
      expect(JSON.stringify(res.body)).not.toMatch(
        /passwordHash|password_hash|not-used/,
      );
    });

    it('verifies an email by hand and audits it', async () => {
      const res = await as(cookies.admin)
        .post(`/v1/admin/users/${userIds.fresh}/verify-email`)
        .expect(201);
      expect((res.body as UserBody['items'][0]).emailVerifiedAt).not.toBeNull();
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'user.verify_email', actorUserId: userIds.admin },
      });
      expect(audit?.details).toMatchObject({ userEmail: email('fresh') });
    });

    it('grants and removes platform-admin access, and the new admin can use the console', async () => {
      await as(cookies.fresh).get('/v1/admin/users').expect(404);

      const granted = await as(cookies.admin)
        .patch(`/v1/admin/users/${userIds.fresh}`)
        .send({ isPlatformAdmin: true, reason: 'New teammate' })
        .expect(200);
      expect((granted.body as UserBody['items'][0]).isPlatformAdmin).toBe(true);
      await as(cookies.fresh).get('/v1/admin/users').expect(200);

      await as(cookies.admin)
        .patch(`/v1/admin/users/${userIds.fresh}`)
        .send({ isPlatformAdmin: false })
        .expect(200);
      await as(cookies.fresh).get('/v1/admin/users').expect(404);

      const actions = (
        await prisma.auditLog.findMany({
          where: { actorUserId: userIds.admin },
          orderBy: { createdAt: 'asc' },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['user.grant_admin', 'user.revoke_admin']),
      );
    });

    it("refuses to change one's own access, to grant to an unverified account and unknown fields", async () => {
      const admin = as(cookies.admin);
      await admin
        .patch(`/v1/admin/users/${userIds.admin}`)
        .send({ isPlatformAdmin: false })
        .expect(400);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userIds.admin } }))
          .isPlatformAdmin,
      ).toBe(true);

      await prisma.user.update({
        where: { id: userIds.fresh },
        data: { emailVerifiedAt: null },
      });
      await admin
        .patch(`/v1/admin/users/${userIds.fresh}`)
        .send({ isPlatformAdmin: true })
        .expect(400);
      await admin
        .patch(`/v1/admin/users/${userIds.ownerB}`)
        .send({ isPlatformAdmin: true, passwordHash: 'x' })
        .expect(400);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: userIds.fresh } }))
          .isPlatformAdmin,
      ).toBe(false);
    });
  });

  describe('support view', () => {
    it('shows setup content, never conversations, and audits each look', async () => {
      const res = await as(cookies.admin)
        .get(`/v1/admin/workspaces/${ids.b}/support-view`)
        .expect(200);
      const body = res.body as {
        workspace: { id: string };
        faqs: { question: string }[];
        sources: { title: string; fileName: string }[];
      };
      expect(body.workspace.id).toBe(ids.b);
      expect(body.faqs.map((f) => f.question)).toEqual([
        `Bravo question ${run}`,
      ]);
      expect(body.sources[0]).toMatchObject({
        title: 'Brochure',
        fileName: 'brochure.pdf',
      });
      expect(JSON.stringify(res.body)).not.toContain('private visitor words');
      expect(JSON.stringify(res.body)).not.toContain(`Alpha question ${run}`);
      expect(JSON.stringify(res.body)).not.toContain('fileKey');

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'workspace.support_view', workspaceId: ids.b },
      });
      expect(audit?.actorEmail).toBe(email('admin'));

      await as(cookies.admin)
        .get(
          '/v1/admin/workspaces/00000000-0000-4000-8000-000000000000/support-view',
        )
        .expect(404);
    });
  });

  describe('deleting a workspace', () => {
    it('needs the slug typed exactly, and a wrong one changes nothing', async () => {
      await as(cookies.admin)
        .delete(`/v1/admin/workspaces/${ids.b}`)
        .send({ confirmSlug: 'not-the-slug' })
        .expect(400);
      await as(cookies.admin)
        .delete(`/v1/admin/workspaces/${ids.b}`)
        .send({})
        .expect(400);
      expect(await prisma.workspace.count({ where: { id: ids.b } })).toBe(1);
    });

    it('removes the workspace and everything under it, keeps the accounts, and keeps the audit row', async () => {
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: ids.b },
      });
      const res = await as(cookies.admin)
        .delete(`/v1/admin/workspaces/${ids.b}`)
        .send({ confirmSlug: workspace.slug, reason: 'Cleanup' })
        .expect(200);
      expect((res.body as { deleted: boolean }).deleted).toBe(true);

      const count = async (
        model:
          'chatbot' | 'faq' | 'knowledgeSource' | 'conversation' | 'message',
      ) =>
        (
          prisma[model] as unknown as {
            count: (a: object) => Promise<number>;
          }
        ).count({ where: { workspaceId: ids.b } });
      expect(await prisma.workspace.count({ where: { id: ids.b } })).toBe(0);
      expect(await prisma.chatbot.count({ where: { id: ids.botB } })).toBe(0);
      for (const model of [
        'faq',
        'knowledgeSource',
        'conversation',
        'message',
      ] as const) {
        expect(await count(model)).toBe(0);
      }
      // The company's people keep their accounts.
      expect(await prisma.user.count({ where: { id: userIds.ownerB } })).toBe(
        1,
      );
      // The audit trail outlives the workspace.
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'workspace.delete', workspaceId: ids.b },
      });
      expect(audit?.workspaceName).toBe(workspace.name);
      expect(audit?.details).toMatchObject({
        slug: workspace.slug,
        files: 1,
        reason: 'Cleanup',
      });
      // The session pointed at it no longer does, and the widget is gone.
      const session = await prisma.session.findFirst({
        where: { userId: userIds.ownerB },
      });
      expect(session?.activeWorkspaceId).toBeNull();
      await request(http)
        .get(`/v1/public/chatbots/${publicIds.b}/config`)
        .expect(404);
      // Other workspaces are untouched.
      expect(await prisma.workspace.count({ where: { id: ids.a } })).toBe(1);
      expect(await prisma.faq.count({ where: { workspaceId: ids.a } })).toBe(1);

      await as(cookies.admin)
        .delete(`/v1/admin/workspaces/${ids.b}`)
        .send({ confirmSlug: workspace.slug })
        .expect(404);
    });
  });
});
