import { defaultChatbotConfig } from '@brainstack/shared';
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
import { PrismaService } from '../../src/database/prisma.service';
import { SESSION_COOKIE } from '../../src/modules/auth/auth.constants';
import { SessionsService } from '../../src/modules/auth/sessions.service';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { periodOf } from '../../src/modules/usage/usage.service';
import { WidgetFiles } from '../../src/modules/widget-page/widget-files';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { fakeEmbeddingService } from './fake-embedding';

interface ListBody {
  items: {
    id: string;
    name: string;
    status: string;
    plan: string;
    owner: { email: string } | null;
    chatbotCount: number;
    messagesThisMonth: number;
  }[];
  nextCursor: string | null;
}

/**
 * M7-0: the platform-admin API (/v1/admin/*). It crosses tenants on
 * purpose, so these cases prove who can reach it (platform admins only,
 * everyone else gets a 404), what it can change, that a suspended workspace
 * is locked (dashboard API and public widget/chat), and that every change
 * is audited. Runs on real Postgres.
 */
describe('Platform admin (M7-0)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (who: string) => `adm-${run}-${who}@example.test`.toLowerCase();
  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaService;
  let dist: string;
  const ids = { a: '', b: '', botA: '', botB: '' };
  const publicIds = { a: '', b: '' };
  const userIds = { admin: '', ownerA: '', ownerB: '' };
  const cookies = { admin: '', ownerA: '', ownerB: '' };

  const as = (cookie: string) => ({
    get: (path: string) => request(http).get(path).set('Cookie', cookie),
    patch: (path: string) =>
      request(http)
        .patch(path)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
  });
  const page = (publicId: string) => request(http).get(`/w/${publicId}`);
  const publicConfig = (publicId: string) =>
    request(http).get(`/v1/public/chatbots/${publicId}/config`);

  async function publish(workspaceId: string, chatbotId: string) {
    const version = await prisma.chatbotVersion.create({
      data: {
        workspaceId,
        chatbotId,
        version: 1,
        config: defaultChatbotConfig('Admin test'),
      },
    });
    await prisma.chatbot.update({
      where: { id: chatbotId },
      data: { publishedVersionId: version.id },
    });
  }

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'widget-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(
      join(dist, 'index.html'),
      '<!doctype html><html><head><script type="module" crossorigin src="./assets/index-test.js"></script></head><body><div id="app"></div></body></html>',
    );
    writeFileSync(join(dist, 'assets', 'index-test.js'), 'console.log(1);');
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
    prisma = app.get(PrismaService);

    const workspaces = app.get(WorkspacesService);
    const sessions = app.get(SessionsService);
    for (const who of ['admin', 'ownerA', 'ownerB'] as const) {
      const user = await prisma.user.create({
        data: {
          email: email(who),
          name: who,
          passwordHash: 'not-used',
          isPlatformAdmin: who === 'admin',
        },
      });
      userIds[who] = user.id;
    }
    // The admin also owns a workspace of their own (a normal member too).
    const adminWs = await workspaces.createWithOwner({
      name: `Adm Own ${run}`,
      ownerUserId: userIds.admin,
    });
    const a = await workspaces.createWithOwner({
      name: `Adm Alpha ${run}`,
      ownerUserId: userIds.ownerA,
    });
    const b = await workspaces.createWithOwner({
      name: `Adm Bravo ${run}`,
      ownerUserId: userIds.ownerB,
    });
    Object.assign(ids, {
      a: a.id,
      b: b.id,
      botA: a.chatbots[0].id,
      botB: b.chatbots[0].id,
      adminWs: adminWs.id,
    });
    publicIds.a = a.chatbots[0].publicId;
    publicIds.b = b.chatbots[0].publicId;
    await publish(ids.a, ids.botA);
    await publish(ids.b, ids.botB);
    await prisma.usageCounter.create({
      data: {
        workspaceId: ids.a,
        period: periodOf(new Date()),
        messages: 7,
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
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: { actorEmail: { startsWith: `adm-${run}-` } },
      });
      await prisma.workspace.deleteMany({
        where: {
          OR: [
            { id: { in: [ids.a, ids.b].filter(Boolean) } },
            { name: `Adm Own ${run}` },
          ],
        },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: `adm-${run}-` } },
      });
    }
    await app?.close();
    rmSync(dist, { recursive: true, force: true });
  });

  describe('who can reach /v1/admin/*', () => {
    it('answers 404 (not 403) to a normal workspace owner on every admin endpoint', async () => {
      const owner = as(cookies.ownerA);
      await owner.get('/v1/admin/workspaces').expect(404);
      await owner.get('/v1/admin/audit-log').expect(404);
      await owner
        .patch(`/v1/admin/workspaces/${ids.b}`)
        .send({ status: 'SUSPENDED' })
        .expect(404);
      await owner
        .patch(`/v1/admin/workspaces/${ids.a}`)
        .send({ plan: 'GROWTH' })
        .expect(404);

      const [a, b] = await Promise.all([
        prisma.workspace.findUniqueOrThrow({ where: { id: ids.a } }),
        prisma.workspace.findUniqueOrThrow({ where: { id: ids.b } }),
      ]);
      expect([a.status, a.plan, b.status]).toEqual([
        'ACTIVE',
        'BETA',
        'ACTIVE',
      ]);
    });

    it('answers 401 without a session', async () => {
      await request(http).get('/v1/admin/workspaces').expect(401);
    });

    it('cannot be switched on through signup: the flag is refused', async () => {
      await request(http)
        .post('/v1/auth/register')
        .set('X-Requested-With', 'fetch')
        .send({
          name: 'Mallory',
          email: email('mallory'),
          password: 'Correct-Horse-Battery-9',
          companyName: `Mallory Co ${run}`,
          isPlatformAdmin: true,
        })
        .expect(400);
      expect(
        await prisma.user.count({ where: { email: email('mallory') } }),
      ).toBe(0);
    });
  });

  describe('listing workspaces', () => {
    it('shows owner, plan, created date, chatbot count and messages this month (counts only)', async () => {
      const res = await as(cookies.admin)
        .get(`/v1/admin/workspaces?q=Adm%20Alpha%20${run}`)
        .expect(200);
      const body = res.body as ListBody;
      expect(body.items).toHaveLength(1);
      expect(body.items[0]).toMatchObject({
        id: ids.a,
        status: 'ACTIVE',
        plan: 'BETA',
        owner: { email: email('ownerA') },
        chatbotCount: 1,
        messagesThisMonth: 7,
      });
      expect(Object.keys(body.items[0]).sort()).toEqual([
        'chatbotCount',
        'createdAt',
        'id',
        'messagesThisMonth',
        'name',
        'owner',
        'plan',
        'slug',
        'status',
      ]);
    });

    it("finds a workspace by its owner's email, case-insensitively", async () => {
      const res = await as(cookies.admin)
        .get(`/v1/admin/workspaces?q=${email('ownerB').toUpperCase()}`)
        .expect(200);
      expect((res.body as ListBody).items.map((i) => i.id)).toEqual([ids.b]);
    });

    it('pages with a cursor and filters by status', async () => {
      const first = (
        await as(cookies.admin)
          .get(`/v1/admin/workspaces?q=Adm%20&limit=1`)
          .expect(200)
      ).body as ListBody;
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBe(first.items[0].id);

      const second = (
        await as(cookies.admin)
          .get(
            `/v1/admin/workspaces?q=Adm%20&limit=1&cursor=${first.nextCursor}`,
          )
          .expect(200)
      ).body as ListBody;
      expect(second.items).toHaveLength(1);
      expect(second.items[0].id).not.toBe(first.items[0].id);

      const suspended = (
        await as(cookies.admin)
          .get(`/v1/admin/workspaces?q=Adm%20&status=SUSPENDED`)
          .expect(200)
      ).body as ListBody;
      expect(suspended.items).toEqual([]);
    });

    it('rejects a bad filter', async () => {
      await as(cookies.admin)
        .get('/v1/admin/workspaces?status=NOPE')
        .expect(400);
    });
  });

  describe('changing a plan', () => {
    it('sets the plan and writes an audit row', async () => {
      const res = await as(cookies.admin)
        .patch(`/v1/admin/workspaces/${ids.a}`)
        .send({ plan: 'GROWTH', reason: 'beta partner' })
        .expect(200);
      expect((res.body as ListBody['items'][number]).plan).toBe('GROWTH');

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { workspaceId: ids.a, action: 'workspace.set_plan' },
      });
      expect(log).toMatchObject({
        actorUserId: userIds.admin,
        actorEmail: email('admin'),
        workspaceName: `Adm Alpha ${run}`,
        details: { from: 'BETA', to: 'GROWTH', reason: 'beta partner' },
      });
      expect(log.createdAt).toBeInstanceOf(Date);
    });

    it('rejects an unknown plan, an empty change and an unknown workspace', async () => {
      const admin = as(cookies.admin);
      await admin
        .patch(`/v1/admin/workspaces/${ids.a}`)
        .send({ plan: 'PLATINUM' })
        .expect(400);
      await admin.patch(`/v1/admin/workspaces/${ids.a}`).send({}).expect(400);
      await admin
        .patch(`/v1/admin/workspaces/${randomUUID()}`)
        .send({ plan: 'BETA' })
        .expect(404);
      await admin
        .patch(`/v1/admin/workspaces/${ids.a}`)
        .send({ plan: 'BETA', ownerId: 'x' })
        .expect(400);
    });
  });

  describe('suspending a workspace', () => {
    it('locks its members and its public widget, leaves other workspaces alone, then unsuspends', async () => {
      // Prime the widget page cache while the workspace is live.
      await page(publicIds.a).expect(200);
      await publicConfig(publicIds.a).expect(200);
      await as(cookies.ownerA).get('/v1/chatbot').expect(200);

      const res = await as(cookies.admin)
        .patch(`/v1/admin/workspaces/${ids.a}`)
        .send({ status: 'SUSPENDED', reason: 'abuse report' })
        .expect(200);
      expect((res.body as ListBody['items'][number]).status).toBe('SUSPENDED');

      // Members: a clear "suspended" error on the dashboard API...
      const blocked = await as(cookies.ownerA).get('/v1/chatbot').expect(403);
      expect(blocked.body).toMatchObject({
        code: 'WORKSPACE_SUSPENDED',
        message: expect.stringContaining('suspended') as string,
      });
      // ...while /auth/me still works and tells the dashboard why.
      const me = await as(cookies.ownerA).get('/v1/auth/me').expect(200);
      expect(
        (me.body as { activeWorkspace: { status: string } }).activeWorkspace
          .status,
      ).toBe('SUSPENDED');

      // The public widget and chat stop at once (cache invalidated).
      await page(publicIds.a).expect(404);
      await publicConfig(publicIds.a).expect(404);
      await request(http)
        .post(`/v1/public/chatbots/${publicIds.a}/conversations`)
        .set('X-Requested-With', 'fetch')
        .send({ visitorId: 'visitor_abc12345', originUrl: 'https://x.test/' })
        .expect(404);

      // Another workspace is unaffected.
      await as(cookies.ownerB).get('/v1/chatbot').expect(200);
      await page(publicIds.b).expect(200);

      const audit = await as(cookies.admin)
        .get(`/v1/admin/audit-log?workspaceId=${ids.a}`)
        .expect(200);
      expect(
        (audit.body as { items: { action: string }[] }).items.map(
          (i) => i.action,
        ),
      ).toContain('workspace.suspend');

      await as(cookies.admin)
        .patch(`/v1/admin/workspaces/${ids.a}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      await as(cookies.ownerA).get('/v1/chatbot').expect(200);
      await page(publicIds.a).expect(200);
      await publicConfig(publicIds.a).expect(200);

      const actions = (
        await prisma.auditLog.findMany({
          where: { workspaceId: ids.a },
          orderBy: { createdAt: 'asc' },
        })
      ).map((l) => l.action);
      expect(actions).toEqual([
        'workspace.set_plan',
        'workspace.suspend',
        'workspace.unsuspend',
      ]);
    });

    it('a failed or no-op change writes no audit row', async () => {
      const before = await prisma.auditLog.count({
        where: { workspaceId: ids.b },
      });
      await as(cookies.admin)
        .patch(`/v1/admin/workspaces/${ids.b}`)
        .send({ status: 'ACTIVE', plan: 'BETA' })
        .expect(200);
      await as(cookies.admin)
        .patch(`/v1/admin/workspaces/${ids.b}`)
        .send({ status: 'GONE' })
        .expect(400);
      expect(
        await prisma.auditLog.count({ where: { workspaceId: ids.b } }),
      ).toBe(before);
    });
  });
});
