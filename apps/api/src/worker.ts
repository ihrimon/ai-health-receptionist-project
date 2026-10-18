import './worker-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Worker-only entrypoint (M7-7): runs the pg-boss job workers without an
 * HTTP server, so jobs (document indexing, emails) can run in their own
 * process next to one or more `dist/main.js` API processes. Same code and
 * environment as the API; PROCESS_ROLE is forced to `worker` here.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  console.log('BrainStack background worker running (no HTTP port)');
}
void bootstrap();
