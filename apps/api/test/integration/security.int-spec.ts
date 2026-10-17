import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import JSZip from 'jszip';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { EmbeddingService } from '../../src/modules/knowledge/embedding.service';
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

  describe('Word uploads', () => {
    async function signUp(): Promise<string> {
      const res = await post('/v1/auth/register')
        .send({
          name: 'Zip Tester',
          email: `zip-${run}@example.test`,
          password: 'a long enough password 1',
          companyName: `Zip Co ${run}`,
        })
        .expect(201);
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
