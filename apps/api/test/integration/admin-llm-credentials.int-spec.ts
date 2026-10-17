import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/database/prisma.service';
import { SESSION_COOKIE } from '../../src/modules/auth/auth.constants';
import { SessionsService } from '../../src/modules/auth/sessions.service';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { ProviderRegistry } from '../../src/modules/llm/providers/provider-registry';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { fakeEmbeddingService } from './fake-embedding';

interface CredentialBody {
  id: string;
  apiKey?: string;
  maskedKey: string;
  isActive: boolean;
}

/**
 * M6-13: the platform's LLM credentials live under /v1/admin/llm-credentials.
 * Proves a normal owner gets 404 everywhere, an admin can manage them, every
 * change is audited without key material, and no response carries the full
 * key. The provider is faked, so no real API call is made.
 */
describe('Platform LLM credentials (M6-13)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (who: string) => `llmc-${run}-${who}@example.test`;
  // Distinctive, so a leak is easy to spot in any response or audit row.
  const SECRET = `gsk_SECRET${run}_abcdefghij1234`;
  const SECRET2 = `gsk_ROTATED${run}_zyxwvutsrq5678`;
  const BASE = '/v1/admin/llm-credentials';
  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaService;
  const cookies = { admin: '', owner: '' };
  const userIds = { admin: '', owner: '' };
  const wsIds: string[] = [];
  const credIds: string[] = [];

  const as = (cookie: string) => ({
    get: (p: string) => request(http).get(p).set('Cookie', cookie),
    post: (p: string) =>
      request(http)
        .post(p)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
    patch: (p: string) =>
      request(http)
        .patch(p)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
    del: (p: string) =>
      request(http)
        .delete(p)
        .set('Cookie', cookie)
        .set('X-Requested-With', 'fetch'),
  });

  const audits = () =>
    prisma.auditLog.findMany({
      where: { actorEmail: email('admin') },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmbeddingService)
      .useValue(fakeEmbeddingService)
      .overrideProvider(ProviderRegistry)
      .useValue({
        get: () => ({ complete: () => Promise.resolve({ message: {} }) }),
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    const workspaces = app.get(WorkspacesService);
    const sessions = app.get(SessionsService);
    for (const who of ['admin', 'owner'] as const) {
      const user = await prisma.user.create({
        data: {
          email: email(who),
          name: who,
          passwordHash: 'not-used',
          isPlatformAdmin: who === 'admin',
        },
      });
      userIds[who] = user.id;
      const ws = await workspaces.createWithOwner({
        name: `Llmc ${who} ${run}`,
        ownerUserId: user.id,
      });
      wsIds.push(ws.id);
      cookies[who] = `${SESSION_COOKIE}=${
        (await sessions.create({ userId: user.id, activeWorkspaceId: ws.id }))
          .token
      }`;
    }
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.llmCredential.deleteMany({ where: { id: { in: credIds } } });
      await prisma.auditLog.deleteMany({
        where: { actorEmail: { startsWith: `llmc-${run}-` } },
      });
      await prisma.workspace.deleteMany({ where: { id: { in: wsIds } } });
      await prisma.user.deleteMany({
        where: { email: { startsWith: `llmc-${run}-` } },
      });
    }
    await app?.close();
  });

  it('answers 404 (not 403) to a normal owner on every endpoint, and changes nothing', async () => {
    const owner = as(cookies.owner);
    const id = randomUUID();
    await owner.get(BASE).expect(404);
    await owner
      .post(BASE)
      .send({ provider: 'groq', apiKey: SECRET, model: 'm' })
      .expect(404);
    await owner
      .patch(`${BASE}/reorder`)
      .send({ orderedIds: [id] })
      .expect(404);
    await owner.patch(`${BASE}/${id}`).send({ isActive: false }).expect(404);
    await owner.del(`${BASE}/${id}`).expect(404);
    expect(
      await prisma.llmCredential.count({ where: { apiKey: SECRET } }),
    ).toBe(0);
    expect(await audits()).toHaveLength(0);
  });

  it('answers 401 without a session', async () => {
    await request(http).get(BASE).expect(401);
  });

  it('no longer serves the old /v1/llm-credentials path', async () => {
    await as(cookies.admin).get('/v1/llm-credentials').expect(404);
  });

  it('lets an admin add, rotate, pause, reorder and delete, masked and audited without the key', async () => {
    const admin = as(cookies.admin);

    const created = await admin
      .post(BASE)
      .send({ provider: 'groq', apiKey: SECRET, model: 'llama-3.3-70b' })
      .expect(201);
    const createdBody = created.body as CredentialBody;
    credIds.push(createdBody.id);
    expect(createdBody.apiKey).toBeUndefined();
    expect(createdBody.maskedKey).toBe('••••••••1234');
    expect(JSON.stringify(createdBody)).not.toContain('SECRET');

    // The key really is stored (the chat pipeline needs it); only the API hides it.
    const stored = await prisma.llmCredential.findUniqueOrThrow({
      where: { id: createdBody.id },
    });
    expect(stored.apiKey).toBe(SECRET);

    const list = await admin.get(BASE).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(SECRET);
    expect(
      (list.body as CredentialBody[]).some((c) => c.id === createdBody.id),
    ).toBe(true);

    const rotated = await admin
      .patch(`${BASE}/${createdBody.id}`)
      .send({ apiKey: SECRET2 })
      .expect(200);
    expect((rotated.body as CredentialBody).maskedKey).toBe('••••••••5678');
    expect(JSON.stringify(rotated.body)).not.toContain('ROTATED');

    const paused = await admin
      .patch(`${BASE}/${createdBody.id}`)
      .send({ isActive: false })
      .expect(200);
    expect((paused.body as CredentialBody).isActive).toBe(false);

    const all = await prisma.llmCredential.findMany({
      orderBy: { sortOrder: 'asc' },
    });
    const reordered = await admin
      .patch(`${BASE}/reorder`)
      .send({ orderedIds: all.map((c) => c.id).reverse() })
      .expect(200);
    expect(JSON.stringify(reordered.body)).not.toContain('ROTATED');

    await admin.del(`${BASE}/${createdBody.id}`).expect(200);
    expect(
      await prisma.llmCredential.count({ where: { id: createdBody.id } }),
    ).toBe(0);
    await admin.del(`${BASE}/${createdBody.id}`).expect(404);

    const rows = await audits();
    expect(rows.map((r) => r.action)).toEqual([
      'llm_credential.create',
      'llm_credential.update',
      'llm_credential.update',
      'llm_credential.reorder',
      'llm_credential.delete',
    ]);
    for (const row of rows) {
      expect(row.actorUserId).toBe(userIds.admin);
      expect(row.createdAt).toBeInstanceOf(Date);
      const text = JSON.stringify(row);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(SECRET2);
      expect(text).not.toContain('SECRET');
      expect(text).not.toContain('ROTATED');
    }
    expect(rows[1].details).toMatchObject({ keyRotated: true });
  });

  it('writes no audit row for a rejected request', async () => {
    const before = (await audits()).length;
    await as(cookies.admin)
      .post(BASE)
      .send({ provider: 'nope', apiKey: SECRET, model: 'm' })
      .expect(400);
    await as(cookies.admin)
      .patch(`${BASE}/not-a-uuid`)
      .send({ isActive: false })
      .expect(400);
    expect(await audits()).toHaveLength(before);
  });
});
