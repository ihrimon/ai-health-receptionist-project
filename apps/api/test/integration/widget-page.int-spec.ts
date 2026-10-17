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
import { PrismaClient } from '../../src/generated/prisma/client';
import { createAdminPrisma } from './admin-prisma';
import { SESSION_COOKIE } from '../../src/modules/auth/auth.constants';
import { SessionsService } from '../../src/modules/auth/sessions.service';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { WidgetFiles } from '../../src/modules/widget-page/widget-files';
import { WorkspacesService } from '../../src/modules/workspaces/workspaces.service';
import { fakeEmbeddingService } from './fake-embedding';

/** The `frame-ancestors` sources of a response's CSP, or null without one. */
function frameAncestors(res: { headers: Record<string, string | undefined> }) {
  const csp = res.headers['content-security-policy'] ?? '';
  const directive = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith('frame-ancestors '));
  return directive
    ? directive.slice('frame-ancestors '.length).split(' ')
    : null;
}

/**
 * M4-18, M4-19: the widget page `/w/:publicId` may only be framed by the
 * chatbot's own allowed domains (`frame-ancestors`, D-2 §4). A browser
 * refuses to show it in an iframe on any other site, so an unlisted
 * domain is rejected; the CSP is the whole protection, so these cases
 * check exactly what it allows. Tenant isolation: one chatbot's page
 * never carries another one's domains. Runs on real Postgres.
 */
describe('Widget page (M4-18, M4-19)', () => {
  const run = randomUUID().slice(0, 8);
  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaClient;
  let dist: string;
  const ids = { a: '', b: '', c: '', botA: '', botB: '', botC: '' };
  const publicIds = { a: '', b: '', c: '' };
  const cookies = { a: '', b: '' };

  const page = (publicId: string) => request(http).get(`/w/${publicId}`);
  const setDomains = (cookie: string, domains: string[]) =>
    request(http)
      .put('/v1/chatbot/allowed-domains')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'fetch')
      .send({ domains })
      .expect(200);
  const setStatus = (cookie: string, status: 'ENABLED' | 'DISABLED') =>
    request(http)
      .patch('/v1/chatbot/status')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'fetch')
      .send({ status })
      .expect(200);

  /** Makes a chatbot live without the publish rules (they're tested elsewhere). */
  async function publish(workspaceId: string, chatbotId: string) {
    const version = await prisma.chatbotVersion.create({
      data: {
        workspaceId,
        chatbotId,
        version: 1,
        config: defaultChatbotConfig('Widget page'),
      },
    });
    await prisma.chatbot.update({
      where: { id: chatbotId },
      data: { publishedVersionId: version.id },
    });
  }

  beforeAll(async () => {
    // A stand-in for apps/widget/dist, so the test doesn't need a build.
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
    // Owner connection: not subject to RLS, so tests can arrange and check
    // data across workspaces (the app itself runs as brainstack_app).
    prisma = createAdminPrisma();

    const workspaces = app.get(WorkspacesService);
    const sessions = app.get(SessionsService);
    for (const who of ['a', 'b', 'c'] as const) {
      const user = await prisma.user.create({
        data: {
          email: `wp-${run}-${who}@example.test`,
          name: who,
          passwordHash: 'not-used',
        },
      });
      const ws = await workspaces.createWithOwner({
        name: `Widget page ${who} ${run}`,
        ownerUserId: user.id,
      });
      const bot = ws.chatbots[0];
      ids[who] = ws.id;
      ids[`bot${who.toUpperCase()}` as 'botA'] = bot.id;
      publicIds[who] = bot.publicId;
      if (who !== 'c') {
        const { token } = await sessions.create({
          userId: user.id,
          activeWorkspaceId: ws.id,
        });
        cookies[who] = `${SESSION_COOKIE}=${token}`;
      }
    }
    // A and B are live; C is never published.
    await publish(ids.a, ids.botA);
    await publish(ids.b, ids.botB);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.workspace.deleteMany({
        where: { id: { in: Object.values(ids).filter(Boolean) } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: `wp-${run}-` } },
      });
    }
    await app?.close();
    await prisma?.$disconnect();
    rmSync(dist, { recursive: true, force: true });
  });

  it("serves the page with frame-ancestors from the chatbot's listed domain", async () => {
    await setDomains(cookies.a, ['shop.example.com']);

    const res = await page(publicIds.a).expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(frameAncestors(res)).toEqual(['https://shop.example.com']);
    // The build's relative asset paths work from /w/<publicId>.
    expect(res.text).toContain('src="/w/assets/index-test.js"');
  });

  it('rejects an unlisted domain: only the listed sources are allowed', async () => {
    await setDomains(cookies.a, ['shop.example.com']);

    const sources = frameAncestors(await page(publicIds.a).expect(200));
    for (const unlisted of [
      'https://evil.example.net',
      'https://example.com',
      'https://other.example.com',
      'http://shop.example.com',
      '*',
      "'self'",
    ]) {
      expect(sources).not.toContain(unlisted);
    }
  });

  it('allows a wildcard for subdomains', async () => {
    await setDomains(cookies.a, ['*.example.com', 'shop.example.org']);

    expect(frameAncestors(await page(publicIds.a).expect(200))).toEqual([
      'https://*.example.com',
      'https://shop.example.org',
    ]);
  });

  it("is frame-ancestors 'none' when the list is empty", async () => {
    await setDomains(cookies.a, []);

    expect(frameAncestors(await page(publicIds.a).expect(200))).toEqual([
      "'none'",
    ]);
  });

  it('sets the other security headers and a strict CSP', async () => {
    const res = await page(publicIds.a).expect(200);
    const csp = String(res.headers['content-security-policy']);

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('unsafe');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  describe('cache', () => {
    it('reuses the value, and a domain change replaces it at once', async () => {
      await setDomains(cookies.a, ['first.example.com']);
      expect(frameAncestors(await page(publicIds.a).expect(200))).toEqual([
        'https://first.example.com',
      ]);

      // Changed behind the API's back: the cached value is still served.
      await prisma.chatbot.update({
        where: { id: ids.botA },
        data: { allowedDomains: ['sneaky.example.com'] },
      });
      expect(frameAncestors(await page(publicIds.a).expect(200))).toEqual([
        'https://first.example.com',
      ]);

      // Changed through the API: the next page has the new list.
      await setDomains(cookies.a, ['second.example.com']);
      expect(frameAncestors(await page(publicIds.a).expect(200))).toEqual([
        'https://second.example.com',
      ]);
    });

    it('switching the chatbot off is a 404 at once, and back on serves it again', async () => {
      await page(publicIds.a).expect(200);
      await setStatus(cookies.a, 'DISABLED');
      await page(publicIds.a).expect(404);
      await setStatus(cookies.a, 'ENABLED');
      await page(publicIds.a).expect(200);
    });
  });

  describe('tenant isolation', () => {
    it("a chatbot's page never carries another chatbot's domains", async () => {
      await setDomains(cookies.a, ['a-shop.example.com']);
      await setDomains(cookies.b, ['b-shop.example.net', '*.b-brand.example']);

      const a = frameAncestors(await page(publicIds.a).expect(200));
      const b = frameAncestors(await page(publicIds.b).expect(200));
      expect(a).toEqual(['https://a-shop.example.com']);
      expect(b).toEqual([
        'https://b-shop.example.net',
        'https://*.b-brand.example',
      ]);
    });

    it("B changing its list leaves A's page as it was", async () => {
      await setDomains(cookies.a, ['a-shop.example.com']);
      await page(publicIds.a).expect(200);
      await setDomains(cookies.b, ['a-shop-copy.example.net']);

      expect(frameAncestors(await page(publicIds.a).expect(200))).toEqual([
        'https://a-shop.example.com',
      ]);
      const a = await prisma.chatbot.findUniqueOrThrow({
        where: { id: ids.botA },
      });
      expect(a.allowedDomains).toEqual(['a-shop.example.com']);
    });

    it('an unknown public ID is a 404 page with no domains', async () => {
      const res = await page(`cb_${run}unknown00`).expect(404);
      expect(res.text).toContain("isn't available");
      expect(res.text).not.toContain('/w/assets/');
      expect(frameAncestors(res)).toBeNull();
    });

    it('an unpublished chatbot is the same 404, even with domains', async () => {
      await prisma.chatbot.update({
        where: { id: ids.botC },
        data: { allowedDomains: ['c-shop.example.com'] },
      });
      const res = await page(publicIds.c).expect(404);
      expect(res.text).not.toContain('c-shop.example.com');
      expect(String(res.headers['content-security-policy'])).not.toContain(
        'c-shop',
      );
    });

    it('a suspended workspace is a 404', async () => {
      // Drops B's cached value; one cached before a suspension would
      // expire within the TTL.
      await setDomains(cookies.b, ['b-shop.example.net']);
      await prisma.workspace.update({
        where: { id: ids.b },
        data: { status: 'SUSPENDED' },
      });
      await page(publicIds.b).expect(404);
      await prisma.workspace.update({
        where: { id: ids.b },
        data: { status: 'ACTIVE' },
      });
    });
  });

  describe('verify installation (M4-14)', () => {
    type Install = {
      installVerifiedAt: string | null;
      installVerifiedHost: string | null;
    };
    const install = async (cookie: string) =>
      (await request(http).get('/v1/chatbot').set('Cookie', cookie).expect(200))
        .body as Install;
    const framedBy = (publicId: string, referer: string) =>
      page(publicId)
        .set('Referer', referer)
        .set('Sec-Fetch-Dest', 'iframe')
        .expect(200);
    const reset = (chatbotId: string) =>
      prisma.chatbot.update({
        where: { id: chatbotId },
        data: { installVerifiedAt: null, installVerifiedHost: null },
      });
    const notDetected = expect.objectContaining({
      installVerifiedAt: null,
      installVerifiedHost: null,
    }) as Install;

    beforeEach(async () => {
      await reset(ids.botA);
      await reset(ids.botB);
      // Also drops the cached "installed" flag.
      await setDomains(cookies.a, ['a-shop.example.com']);
      await setDomains(cookies.b, ['b-shop.example.net']);
    });

    it('is not detected until the page loads inside an allowed site', async () => {
      await page(publicIds.a).expect(200);
      await framedBy(publicIds.a, 'https://unlisted.example.org/');
      // Opened in a tab from the right site: not an install.
      await page(publicIds.a)
        .set('Referer', 'https://a-shop.example.com/')
        .set('Sec-Fetch-Dest', 'document')
        .expect(200);

      expect(await install(cookies.a)).toEqual(notDetected);
    });

    it('records the first load from an allowed site, from the Referer or ?host=', async () => {
      await framedBy(publicIds.a, 'https://a-shop.example.com/products/1');
      const first = await install(cookies.a);
      expect(first.installVerifiedHost).toBe('a-shop.example.com');
      expect(first.installVerifiedAt).not.toBeNull();

      // A later load never moves the date.
      await framedBy(publicIds.a, 'https://a-shop.example.com/');
      expect((await install(cookies.a)).installVerifiedAt).toBe(
        first.installVerifiedAt,
      );

      // A site that sends no Referer: the loader's ?host= counts.
      await page(publicIds.b)
        .query({ host: 'https://b-shop.example.net' })
        .expect(200);
      expect((await install(cookies.b)).installVerifiedHost).toBe(
        'b-shop.example.net',
      );
    });

    it('resets when that site is removed from the allowed domains', async () => {
      await framedBy(publicIds.a, 'https://a-shop.example.com/');
      await setDomains(cookies.a, ['a-new-shop.example.com']);

      expect(await install(cookies.a)).toEqual(notDetected);
    });

    it("one workspace's site never marks another workspace's chatbot", async () => {
      // A's site on B's page, and B's site on A's page: neither counts.
      await framedBy(publicIds.b, 'https://a-shop.example.com/');
      await page(publicIds.a)
        .query({ host: 'https://b-shop.example.net' })
        .expect(200);
      expect(await install(cookies.a)).toEqual(notDetected);
      expect(await install(cookies.b)).toEqual(notDetected);

      // A's own site marks only A.
      await framedBy(publicIds.a, 'https://a-shop.example.com/');
      expect((await install(cookies.a)).installVerifiedHost).toBe(
        'a-shop.example.com',
      );
      expect(await install(cookies.b)).toEqual(notDetected);
      const b = await prisma.chatbot.findUniqueOrThrow({
        where: { id: ids.botB },
      });
      expect(b.installVerifiedAt).toBeNull();
    });
  });

  describe('static files', () => {
    it('serves the hashed assets with a long cache', async () => {
      const res = await request(http)
        .get('/w/assets/index-test.js')
        .expect(200);
      expect(res.headers['content-type']).toContain('javascript');
      expect(res.headers['cache-control']).toContain('immutable');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('refuses paths outside the assets folder', async () => {
      await request(http).get('/w/assets/..%2Findex.html').expect(404);
      await request(http).get('/w/assets/.hidden').expect(404);
      await request(http).get('/w/assets/missing.js').expect(404);
    });

    it('serves the loader at /chatbot.js for any site', async () => {
      const res = await request(http).get('/chatbot.js').expect(200);
      expect(res.headers['content-type']).toContain('text/javascript');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });
  });
});
