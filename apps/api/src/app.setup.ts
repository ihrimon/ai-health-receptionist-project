import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Request } from 'express';
import { corsOptionsFor } from './common/cors';
import { requireFetchHeader } from './common/require-fetch-header';

/**
 * HTTP setup shared by main.ts and the integration tests, so tests run
 * against the same prefix, CSRF check and validation as production.
 */
export function configureApp(app: NestExpressApplication): void {
  // Behind a reverse proxy, req.ip (used by the auth rate limits) is the
  // proxy's address unless Express trusts X-Forwarded-For. TRUST_PROXY is
  // the number of proxy hops in front of the API; leave unset locally.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', parseInt(process.env.TRUST_PROXY, 10));
  }

  // D-2 §1: everything under /v1, except the health check.
  app.setGlobalPrefix('v1', { exclude: ['health'] });

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
