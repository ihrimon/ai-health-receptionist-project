import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from '../../config/configuration';
import { DatabaseModule } from '../../database/database.module';
import { KnowledgeModule } from './knowledge.module';

/**
 * Minimal bootstrap module for the `knowledge:ingest` CLI script —
 * deliberately NOT the full AppModule. The script runs through
 * NestFactory.createApplicationContext() (no HTTP server) and only needs
 * config + DB + knowledge retrieval, so it skips Queue/Chat/Auth entirely.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
    KnowledgeModule,
  ],
})
export class KnowledgeIngestModule {}
