import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);

  console.log(
    `🚀 BrainStack AI Receptionist API running on http://localhost:${port}`,
  );
}
void bootstrap();
