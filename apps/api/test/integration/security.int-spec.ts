import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import JSZip from 'jszip';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
import { createAdminPrisma } from './admin-prisma';
import { fakeEmbeddingService } from './fake-embedding';

/**
 * M7-2: checks from the security review that need the whole HTTP stack:
 * response headers, the limits on the anonymous email routes, and the
 * zip-bomb check on Word uploads.
 */
describe('Security review (M7-2)', () => {
  const run = randomUUID().slice(0, 8);
  let app: NestExpressApplication;
  let http: App;
  // A caller address of its own, so the limits (kept in Postgres) of other
  // tests and earlier runs never count against this one.
  const callerIp = `10.${parseInt(run.slice(0, 2), 16)}.${parseInt(run.slice(2, 4), 16)}.${parseInt(run.slice(4, 6), 16) || 1}`;

  const post = (path: string, ip = callerIp) =>
    request(http)
      .post(path)
      .set('X-Requested-With', 'fetch')
      .set('X-Forwarded-For', ip);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmbeddingService)
      .useValue(fakeEmbeddingService)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    // Let the test pick its caller address with X-Forwarded-For.
    app.set('trust proxy', true);
    await app.init();
    http = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('response headers', () => {
    it('API responses forbid sniffing and framing, and hide the framework', async () => {
      const res = await request(http).get('/v1/auth/me').expect(401);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('a call refused for a missing X-Requested-With still carries the CORS headers (M7-38)', async () => {
      const res = await request(http)
        .post('/v1/auth/logout')
        .set('Origin', 'http://localhost:3000')
        .expect(403);
      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('the preflight answer may be cached by the browser (M7-38)', async () => {
      const res = await request(http)
        .options('/v1/knowledge-sources/upload')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'x-requested-with')
        .expect(204);
      expect(res.headers['access-control-max-age']).toBe('7200');
    });

    it('the widget page keeps its own headers so a company site can frame it', async () => {
      const res = await request(http).get('/w/cb_doesnotexist').expect(404);
      expect(res.headers['x-frame-options']).toBeUndefined();
    });
  });

  describe('anonymous email routes are rate limited', () => {
    it('answers 429 with Retry-After after 10 password-reset attempts from one address', async () => {
      const body = {
        token: 'x'.repeat(30),
        newPassword: 'a brand new password',
      };
      for (let i = 0; i < 10; i++) {
        await post('/v1/auth/reset-password').send(body).expect(400);
      }
      const limited = await post('/v1/auth/reset-password')
        .send(body)
        .expect(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      // Another caller is not affected.
      await post('/v1/auth/reset-password', '203.0.113.7')
        .send({ ...body, token: 'y'.repeat(30) })
        .expect(400);
    });

    it('answers 429 after 30 email-verification attempts from one address', async () => {
      for (let i = 0; i < 30; i++) {
        await post('/v1/auth/verify-email')
          .send({ token: 'z'.repeat(30) })
          .expect(400);
      }
      await post('/v1/auth/verify-email')
        .send({ token: 'z'.repeat(30) })
        .expect(429);
    });

    it('answers 429 after 10 forgot-password requests from one address, whatever the email', async () => {
      for (let i = 0; i < 10; i++) {
        await post('/v1/auth/forgot-password')
          .send({ email: `nobody-${run}-${i}@example.test` })
          .expect(204);
      }
      await post('/v1/auth/forgot-password')
        .send({ email: `nobody-${run}-last@example.test` })
        .expect(429);
    });
  });

  describe('signup does not reveal registered emails (M7-21)', () => {
    const body = (email: string) => ({
      name: 'Enum Tester',
      email,
      password: 'a long enough password 1',
      companyName: `Enum Co ${run}`,
    });

    it('answers a new and an already-registered email identically, and sets no session', async () => {
      const email = `enum-${run}@example.test`;
      const first = await post('/v1/auth/register', '10.9.0.1')
        .send(body(email))
        .expect(202);
      const again = await post('/v1/auth/register', '10.9.0.2')
        .send(body(email))
        .expect(202);

      expect(again.body).toEqual(first.body);
      expect(first.body).toEqual({ status: 'check_email' });
      expect(first.headers['set-cookie']).toBeUndefined();
      expect(again.headers['set-cookie']).toBeUndefined();
      const admin = createAdminPrisma();
      try {
        expect(await admin.user.count({ where: { email } })).toBe(1);
      } finally {
        await admin.$disconnect();
      }
    });
  });

  describe('login slows down, never locks, across IPs (M7-23)', () => {
    it('makes wrong guesses at one email from many addresses slower, and the right password still works', async () => {
      const email = `slow-${run}@example.test`;
      const password = 'a long enough password 1';
      await post('/v1/auth/register', '10.9.1.1')
        .send({
          name: 'Slow Tester',
          email,
          password,
          companyName: `Slow Co ${run}`,
        })
        .expect(202);

      // 5 free failures, each from a different address.
      for (let n = 0; n < 5; n++) {
        await post('/v1/auth/login', `10.9.2.${n + 1}`)
          .send({ email, password: 'wrong password here' })
          .expect(401);
      }
      // 2 more: the next attempt waits 2 x 500 ms.
      for (let n = 5; n < 7; n++) {
        await post('/v1/auth/login', `10.9.2.${n + 1}`)
          .send({ email, password: 'wrong password here' })
          .expect(401);
      }
      const started = Date.now();
      await post('/v1/auth/login', '10.9.2.99')
        .send({ email, password })
        .expect(204);
      expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
    }, 30_000);
  });

  describe('Word uploads', () => {
    async function signUp(): Promise<string> {
      await post('/v1/auth/register')
        .send({
          name: 'Zip Tester',
          email: `zip-${run}@example.test`,
          password: 'a long enough password 1',
          companyName: `Zip Co ${run}`,
        })
        .expect(202);
      const res = await post('/v1/auth/login')
        .send({
          email: `zip-${run}@example.test`,
          password: 'a long enough password 1',
        })
        .expect(204);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      return cookies[0].split(';')[0];
    }

    async function docx(): Promise<Buffer> {
      const zip = new JSZip();
      zip.file('[Content_Types].xml', '<Types/>');
      zip.file('word/document.xml', '<w:document>Hello</w:document>');
      return zip.generateAsync({ type: 'nodebuffer' });
    }

    it('refuses a .docx that declares gigabytes once unpacked (400), and stores nothing', async () => {
      const cookie = await signUp();
      const bomb = Buffer.from(await docx());
      for (let i = 0; i < bomb.length - 4; i++) {
        if (bomb.readUInt32LE(i) === 0x02014b50) {
          bomb.writeUInt32LE(0x7fffffff, i + 24);
        }
      }
      const res = await post('/v1/knowledge-sources/upload')
        .set('Cookie', cookie)
        .attach('file', bomb, 'bomb.docx')
        .expect(400);
      expect(JSON.stringify(res.body)).toContain('too large once unpacked');

      const list = await request(http)
        .get('/v1/knowledge-sources')
        .set('Cookie', cookie)
        .expect(200);
      expect(list.body).toEqual([]);
    });
  });
});
