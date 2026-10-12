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
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { runWithTenant } from '../../src/tenancy/tenant-context';
import { TENANT_PRISMA, TenantPrisma } from '../../src/tenancy/tenant-prisma';

/**
 * M1-25 (W4): two workspaces, proving A's users can't read or change B's
 * data — through the HTTP API and through the tenant Prisma client.
 * Runs on a real Postgres (+ Redis) test database.
 */
describe('Tenant isolation (M1-25)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (who: string) => `iso-${run}-${who}@example.test`;

  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaService;
  let db: TenantPrisma;

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
  });

  // Prisma queries are lazy: they run when awaited, so await inside the
  // context (as request handlers do).
  const inWorkspace = <T>(workspaceId: string, fn: () => PromiseLike<T>) =>
    runWithTenant(
      { workspaceId, userId: 'test', role: WorkspaceRole.OWNER },
      async () => await fn(),
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
