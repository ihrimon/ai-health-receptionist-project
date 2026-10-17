import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Request } from 'express';
import { corsOptionsFor } from './common/cors';
import { requireFetchHeader } from './common/require-fetch-header';
import { securityHeaders } from './common/security-headers';

/**
 * HTTP setup shared by main.ts and the integration tests, so tests run
 * against the same prefix, CSRF check and validation as production.
 */
export function configureApp(app: NestExpressApplication): void {
  // Behind a reverse proxy, req.ip (used by the auth rate limits) is the
  // proxy's address unless Express trusts X-Forwarded-For. TRUST_PROXY is
  // the number of proxy hops in front of the API; leave unset locally.
  if (process.env.TRUST_PROXY) {
    const hops = parseInt(process.env.TRUST_PROXY, 10);
    if (!Number.isInteger(hops) || hops < 0) {
      // A typo here would silently turn off the per-IP limits or let a
      // caller pick its own IP with X-Forwarded-For.
      throw new Error('TRUST_PROXY must be a number of proxy hops (e.g. 1)');
    }
    app.set('trust proxy', hops);
  } else if (process.env.NODE_ENV === 'production') {
    new Logger('Bootstrap').warn(
      'TRUST_PROXY is not set: behind a reverse proxy every visitor shares ' +
        "the proxy's IP, so the per-IP rate limits (login, signup, public " +
        'chat) hit all users together. Set it to the number of proxy hops.',
    );
  }
  // Don't announce the framework.
  app.disable('x-powered-by');

  // D-2 §1: everything under /v1, except the health check and the widget
  // page with its files (M4-19), whose URLs are in every embed snippet.
  app.setGlobalPrefix('v1', {
    exclude: ['health', 'w/:publicId', 'w/assets/:file', 'chatbot.js'],
  });

  app.use(securityHeaders);
  app.use(cookieParser());
  app.use(requireFetchHeader);

  const allowed = {
    dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:3000',
    // The widget app's origin (apps/widget, Vite on :3002 locally).
    widgetUrl: process.env.WIDGET_URL ?? 'http://localhost:3002',
  };
  app.enableCors((req: Request, callback) => {
    callback(
      null,
      corsOptionsFor(req.headers.origin, req.originalUrl ?? req.url, allowed),
    );
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
}
