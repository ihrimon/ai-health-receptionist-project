import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { requireFetchHeader } from './common/require-fetch-header';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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

  app.enableCors({
    origin: process.env.DASHBOARD_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);

  console.log(
    `🚀 BrainStack AI Receptionist API running on http://localhost:${port}`,
  );
}
void bootstrap();
