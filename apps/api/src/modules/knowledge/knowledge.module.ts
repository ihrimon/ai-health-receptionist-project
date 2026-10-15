import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { EmbeddingService } from './embedding.service';
import { KnowledgeIngestProcessor } from './knowledge-ingest.processor';
import { KnowledgeIngestQueue } from './knowledge-ingest.queue';
import { KnowledgeIngestService } from './knowledge-ingest.service';
import { KnowledgeService } from './knowledge.service';

/**
 * Indexing and search over knowledge chunks (M2-11, M2-12). The
 * dashboard's knowledge base (modules/knowledge-base) queues sources here.
 */
@Module({
  imports: [QueueModule],
  providers: [
    EmbeddingService,
    KnowledgeService,
    KnowledgeIngestService,
    KnowledgeIngestQueue,
    KnowledgeIngestProcessor,
  ],
  exports: [KnowledgeService, KnowledgeIngestQueue],
})
export class KnowledgeModule {}
