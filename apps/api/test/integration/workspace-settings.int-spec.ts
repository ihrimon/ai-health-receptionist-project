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
import { fakeEmbeddingService } from './fake-embedding';

interface Profile {
  id: string;
  name: string;
  slug: string;
  plan: string;
  website: string | null;
  industry: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  timeZone: string;
}
interface Member {
  name: string;
  email: string;
  role: string;
  joinedAt: string;
}

/**
 * M7-42: Settings → Workspace and the signed-in person's own account:
 * who may read and change the company profile, that the member list is
 * the workspace's own and shows nothing secret, and the password change.
 * Runs on real Postgres.
 */
describe('Workspace settings and own account (M7-42)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (who: string) => `ws-${run}-${who}@example.test`.toLowerCase();
  const password = 'Correct-Horse-Battery-9';
  // A caller address of its own for the limits kept in Postgres.
  const callerIp = `10.${parseInt(run.slice(0, 2), 16)}.${parseInt(run.slice(2, 4), 16)}.${parseInt(run.slice(4, 6), 16) || 1}`;
  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaClient;
  const cookies = {
    ownerA: '',
    adminA: '',
    viewerA: '',
    ownerB: '',
  };
  const ids = { a: '', b: '' };

  const as = (cookie: string) => ({
    get: (path: string) => request(http).get(path).set('Cookie', cookie),
    patch: (path: string) =>
      request(http)
        .patch(path)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
    post: (path: string) =>
      request(http)
        .post(path)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
  });
  const anon = (path: string) =>
    request(http)
      .post(path)
      .set('X-Requested-With', 'fetch')
      .set('X-Forwarded-For', callerIp);

  async function signUp(who: string, company: string) {
    await anon('/v1/auth/register')
      .send({ name: who, email: email(who), password, companyName: company })
      .expect(202);
    return login(who, password);
  }
  async function login(who: string, pw: string) {
    const res = await anon('/v1/auth/login')
      .send({ email: email(who), password: pw })
      .expect(204);
    const raw = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith(`${SESSION_COOKIE}=`),
    )!;
    return raw.split(';')[0];
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

    cookies.ownerA = await signUp('ownerA', `WS Alpha ${run}`);
    cookies.ownerB = await signUp('ownerB', `WS Bravo ${run}`);
    const [a, b] = await Promise.all(
      (['ownerA', 'ownerB'] as const).map((who) =>
        prisma.workspaceMember.findFirstOrThrow({
          where: { user: { email: email(who) } },
        }),
      ),
    );
    ids.a = a.workspaceId;
    ids.b = b.workspaceId;

    // An admin and a viewer join workspace A.
    const sessions = app.get(SessionsService);
    for (const [who, role] of [
      ['adminA', 'ADMIN'],
      ['viewerA', 'VIEWER'],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          email: email(who),
          name: who,
          passwordHash: 'not-used',
          emailVerifiedAt: new Date(),
        },
      });
      await prisma.workspaceMember.create({
        data: { workspaceId: ids.a, userId: user.id, role },
      });
      cookies[who] = `${SESSION_COOKIE}=${
        (await sessions.create({ userId: user.id, activeWorkspaceId: ids.a }))
          .token
      }`;
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.workspace.deleteMany({
        where: { name: { endsWith: ` ${run}` } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: `ws-${run}-` } },
      });
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('the workspace profile', () => {
    it('shows each member their own workspace, with empty details and UTC to start', async () => {
      const a = (await as(cookies.viewerA).get('/v1/workspace').expect(200))
        .body as Profile;
      expect(a).toMatchObject({
        id: ids.a,
        name: `WS Alpha ${run}`,
        plan: 'BETA',
        website: null,
        industry: null,
        contactEmail: null,
        contactPhone: null,
        timeZone: 'UTC',
      });
      const b = (await as(cookies.ownerB).get('/v1/workspace').expect(200))
        .body as Profile;
      expect(b.id).toBe(ids.b);
      await request(http).get('/v1/workspace').expect(401);
    });

    it('lets the owner change it, and only the owner', async () => {
      const changed = (
        await as(cookies.ownerA)
          .patch('/v1/workspace')
          .send({
            website: 'https://alpha.example.com',
            industry: 'HVAC',
            contactEmail: 'Hello@Alpha.Example.com',
            contactPhone: '+1 (347) 433-0432',
            timeZone: 'asia/dhaka',
          })
          .expect(200)
      ).body as Profile;
      expect(changed).toMatchObject({
        name: `WS Alpha ${run}`,
        website: 'https://alpha.example.com',
        industry: 'HVAC',
        contactEmail: 'hello@alpha.example.com',
        contactPhone: '+1 (347) 433-0432',
        timeZone: 'Asia/Dhaka',
      });

      await as(cookies.adminA)
        .patch('/v1/workspace')
        .send({ industry: 'Roofing' })
        .expect(403);
      await as(cookies.viewerA)
        .patch('/v1/workspace')
        .send({ industry: 'Roofing' })
        .expect(403);
      const stored = await prisma.workspace.findUniqueOrThrow({
        where: { id: ids.a },
      });
      expect(stored.industry).toBe('HVAC');
    });

    it("never reaches another workspace's profile", async () => {
      await as(cookies.ownerA)
        .patch('/v1/workspace')
        .send({ industry: 'Plumbing' })
        .expect(200);
      const b = await prisma.workspace.findUniqueOrThrow({
        where: { id: ids.b },
      });
      expect(b).toMatchObject({ industry: null, timeZone: 'UTC' });
    });

    it('clears a detail sent blank, and refuses bad input, unknown fields and nothing at all (400)', async () => {
      const cleared = (
        await as(cookies.ownerA)
          .patch('/v1/workspace')
          .send({ website: '', contactPhone: null })
          .expect(200)
      ).body as Profile;
      expect(cleared).toMatchObject({ website: null, contactPhone: null });

      const patch = as(cookies.ownerA).patch;
      await patch('/v1/workspace').send({}).expect(400);
      await patch('/v1/workspace').send({ name: '  ' }).expect(400);
      await patch('/v1/workspace').send({ website: 'example.com' }).expect(400);
      await patch('/v1/workspace').send({ contactEmail: 'nope' }).expect(400);
      await patch('/v1/workspace').send({ timeZone: 'Mars/Base' }).expect(400);
      await patch('/v1/workspace').send({ plan: 'GROWTH' }).expect(400);
      await patch('/v1/workspace').send({ slug: 'mine' }).expect(400);
      expect(
        (await prisma.workspace.findUniqueOrThrow({ where: { id: ids.a } }))
          .plan,
      ).toBe('BETA');
    });

    it('still renames the workspace, keeping its slug', async () => {
      const before = await prisma.workspace.findUniqueOrThrow({
        where: { id: ids.a },
      });
      await as(cookies.ownerA)
        .patch('/v1/workspace')
        .send({ name: `WS Alpha Two ${run}` })
        .expect(200);
      const after = await prisma.workspace.findUniqueOrThrow({
        where: { id: ids.a },
      });
      expect(after.name).toBe(`WS Alpha Two ${run}`);
      expect(after.slug).toBe(before.slug);
    });
  });

  describe('the member list', () => {
    it("shows this workspace's people to owners and admins, and nothing secret", async () => {
      const owner = (
        await as(cookies.ownerA).get('/v1/workspace/members').expect(200)
      ).body as Member[];
      expect(owner.map((m) => [m.email, m.role])).toEqual([
        [email('ownerA'), 'OWNER'],
        [email('adminA'), 'ADMIN'],
        [email('viewerA'), 'VIEWER'],
      ]);
      expect(Object.keys(owner[0]).sort()).toEqual([
        'email',
        'joinedAt',
        'name',
        'role',
      ]);
      const admin = (
        await as(cookies.adminA).get('/v1/workspace/members').expect(200)
      ).body as Member[];
      expect(admin).toHaveLength(3);
      expect(JSON.stringify(owner)).not.toMatch(/password|hash|token/i);
    });

    it("keeps workspace B's people out of A's list and the other way round", async () => {
      const b = (
        await as(cookies.ownerB).get('/v1/workspace/members').expect(200)
      ).body as Member[];
      expect(b.map((m) => m.email)).toEqual([email('ownerB')]);
    });

    it('is closed to viewers (403) and to visitors without a session (401)', async () => {
      await as(cookies.viewerA).get('/v1/workspace/members').expect(403);
      await request(http).get('/v1/workspace/members').expect(401);
    });
  });

  describe('own account', () => {
    it('changes only your own name', async () => {
      await as(cookies.ownerA)
        .patch('/v1/auth/profile')
        .send({ name: '  Rina Karim ' })
        .expect(204);
      const me = (await as(cookies.ownerA).get('/v1/auth/me').expect(200))
        .body as { user: { name: string } };
      expect(me.user.name).toBe('Rina Karim');
      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { email: email('ownerB') },
          })
        ).name,
      ).toBe('ownerB');
      await as(cookies.ownerA)
        .patch('/v1/auth/profile')
        .send({ name: '' })
        .expect(400);
      await as(cookies.ownerA)
        .patch('/v1/auth/profile')
        .send({ name: 'X', isPlatformAdmin: true })
        .expect(400);
      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { email: email('ownerA') },
          })
        ).isPlatformAdmin,
      ).toBe(false);
    });

    it('changes the password: needs the current one, ends other sessions and keeps this one', async () => {
      const here = cookies.ownerB;
      const elsewhere = await login('ownerB', password);
      await as(elsewhere).get('/v1/auth/me').expect(200);

      // Wrong current password: a 400, so the dashboard does not sign out.
      await as(here)
        .post('/v1/auth/change-password')
        .send({
          currentPassword: 'not my password',
          newPassword: 'A better password 77',
        })
        .expect(400);
      // Too common a new password.
      await as(here)
        .post('/v1/auth/change-password')
        .send({ currentPassword: password, newPassword: 'password123' })
        .expect(400);
      // The same one again.
      await as(here)
        .post('/v1/auth/change-password')
        .send({ currentPassword: password, newPassword: password })
        .expect(400);
      await as(elsewhere).get('/v1/auth/me').expect(200);

      await as(here)
        .post('/v1/auth/change-password')
        .send({
          currentPassword: password,
          newPassword: 'A better password 77',
        })
        .expect(204);

      await as(here).get('/v1/auth/me').expect(200);
      await as(elsewhere).get('/v1/auth/me').expect(401);
      await anon('/v1/auth/login')
        .send({ email: email('ownerB'), password })
        .expect(401);
      await login('ownerB', 'A better password 77');
    });

    it('needs a session', async () => {
      await request(http)
        .post('/v1/auth/change-password')
        .set('X-Requested-With', 'fetch')
        .send({
          currentPassword: password,
          newPassword: 'A better password 77',
        })
        .expect(401);
      await request(http)
        .patch('/v1/auth/profile')
        .set('X-Requested-With', 'fetch')
        .send({ name: 'Eve' })
        .expect(401);
    });
  });
});
