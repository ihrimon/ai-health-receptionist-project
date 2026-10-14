import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { WorkspaceRole } from '../../generated/prisma/client';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { runWithTenant } from '../../tenancy/tenant-context';
import { IngestError } from './ingest-error';
import { type IngestJobData, INGEST_ATTEMPTS } from './knowledge-ingest.queue';
import {
  INGEST_FAILED_MESSAGE,
  KnowledgeIngestService,
} from './knowledge-ingest.service';

/**
 * Runs `knowledge-ingest` jobs (M2-11) inside the API process for now; a
 * separate worker process comes with M7-7. One at a time: embedding is
 * CPU-heavy and runs on the same machine as the API.
 */
@Processor(QUEUE_NAMES.KNOWLEDGE_INGEST, { concurrency: 1 })
export class KnowledgeIngestProcessor extends WorkerHost {
  private readonly logger = new Logger(KnowledgeIngestProcessor.name);

  constructor(private readonly ingest: KnowledgeIngestService) {
    super();
  }

  async process(job: Job<IngestJobData>): Promise<void> {
    const { workspaceId, kind, id } = job.data;
    // No request here, so the job sets the workspace context itself; the
    // tenant client and raw SQL then only touch that workspace's rows.
    await runWithTenant(
      {
        workspaceId,
        userId: 'system:knowledge-ingest',
        role: WorkspaceRole.OWNER,
      },
      async () => {
        try {
          await this.ingest.ingest(kind, id);
        } catch (err) {
          if (err instanceof IngestError) {
            await this.ingest.fail(kind, id, err.message);
            return; // The same file would fail again; no retry.
          }
          const attempts = job.opts.attempts ?? INGEST_ATTEMPTS;
          if (job.attemptsMade + 1 >= attempts) {
            await this.ingest.fail(kind, id, INGEST_FAILED_MESSAGE);
          }
          this.logger.error(
            `Indexing ${kind} ${id} failed (attempt ${job.attemptsMade + 1}/${attempts}): ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err; // Lets BullMQ retry with backoff.
        }
      },
    );
  }
}
