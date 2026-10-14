import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { JobsOptions, Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { requireTenant } from '../../tenancy/tenant-context';

/**
 * What a job indexes: a policy/text page or document (M2-11) into chunks,
 * an FAQ into chunks, or a custom answer's trigger question or a product
 * into an embedding on its own row (M2-13).
 */
export type IngestKind = 'source' | 'faq' | 'customAnswer' | 'product';

export interface IngestJobData {
  /** The job runs outside any request, so it carries its workspace. */
  workspaceId: string;
  kind: IngestKind;
  id: string;
}

/** Attempts per job; IngestErrors stop early (retrying can't help). */
export const INGEST_ATTEMPTS = 3;

const JOB_OPTIONS: JobsOptions = {
  attempts: INGEST_ATTEMPTS,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 1000,
  removeOnFail: 1000,
};

/** Queues knowledge for indexing (M2-11, M2-13). */
@Injectable()
export class KnowledgeIngestQueue {
  constructor(
    @InjectQueue(QUEUE_NAMES.KNOWLEDGE_INGEST)
    private readonly queue: Queue<IngestJobData>,
  ) {}

  /**
   * One job per save, not one per item: an edit made while an older job
   * runs must be indexed too. The worker spots a superseded job and skips
   * its write (KnowledgeIngestService). `workspaceId` defaults to the
   * current request's; the re-embed script passes it explicitly.
   */
  async enqueue(
    kind: IngestKind,
    id: string,
    workspaceId = requireTenant().workspaceId,
  ): Promise<void> {
    await this.queue.add(kind, { workspaceId, kind, id }, JOB_OPTIONS);
  }

  /** Several items in one round trip, e.g. after a CSV import. */
  async enqueueMany(kind: IngestKind, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { workspaceId } = requireTenant();
    await this.queue.addBulk(
      ids.map((id) => ({
        name: kind,
        data: { workspaceId, kind, id },
        opts: JOB_OPTIONS,
      })),
    );
  }
}
