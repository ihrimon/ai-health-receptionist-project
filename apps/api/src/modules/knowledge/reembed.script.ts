import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import configuration from '../../config/configuration';
import { DatabaseModule } from '../../database/database.module';
import { PrismaService } from '../../database/prisma.service';
import { runAsSystem } from '../../tenancy/tenant-context';
import { QueueModule } from '../../queue/queue.module';
import { KnowledgeIngestQueue } from './knowledge-ingest.queue';
import { findItemsToReembed, summarize } from './reembed';

/**
 * Just config, database and the queue: this script only queues jobs. The
 * running API's worker does the embedding, so the script never loads the
 * model or competes with the API for CPU.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['../../.env', '.env'],
    }),
    DatabaseModule,
    QueueModule,
  ],
  providers: [KnowledgeIngestQueue],
})
class ReembedModule {}

/**
 * Re-embeds every workspace's knowledge that isn't embedded with the
 * configured model (KNOWLEDGE_EMBEDDING_MODEL), e.g. after switching to a
 * Bangla-capable model (M2-15), and catches up items saved before
 * indexing existed. Queues one job per item; the API must be running to
 * process them.
 *
 *   pnpm --filter api knowledge:reembed            queue the jobs
 *   pnpm --filter api knowledge:reembed --dry-run  only count them
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(ReembedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const model = app
      .get(ConfigService)
      .getOrThrow<string>('knowledge.embeddingModel');
    // Reads every workspace on purpose (M7-1: runs with the RLS bypass).
    const items = await runAsSystem('re-embed all workspaces', () =>
      findItemsToReembed(app.get(PrismaService), model),
    );
    console.log(`Not embedded with ${model}: ${summarize(items)}.`);
    if (dryRun || items.length === 0) return;

    const queue = app.get(KnowledgeIngestQueue);
    for (const item of items) {
      await queue.enqueue(item.kind, item.id, item.workspaceId);
    }
    console.log(
      `Queued ${items.length} job(s). The running API indexes them; watch its log.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
