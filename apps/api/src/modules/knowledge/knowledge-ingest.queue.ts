import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { requireTenant } from '../../tenancy/tenant-context';

export interface IngestJobData {
  /** The job runs outside any request, so it carries its workspace. */
  workspaceId: string;
  sourceId: string;
}

/** Attempts per job; IngestErrors stop early (retrying can't help). */
export const INGEST_ATTEMPTS = 3;

/** Queues a knowledge source for indexing (M2-11). */
@Injectable()
export class KnowledgeIngestQueue {
  constructor(
    @InjectQueue(QUEUE_NAMES.KNOWLEDGE_INGEST)
    private readonly queue: Queue<IngestJobData>,
  ) {}

  /**
   * One job per save, not one per source: an edit made while an older job
   * runs must be indexed too. The worker spots a superseded job and skips
   * its write (KnowledgeIngestService.ingest).
   */
  async enqueue(sourceId: string): Promise<void> {
    await this.queue.add(
      'ingest',
      { workspaceId: requireTenant().workspaceId, sourceId },
      {
        attempts: INGEST_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }
}
