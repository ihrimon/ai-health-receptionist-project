import { Inject, Injectable } from '@nestjs/common';
import type { PgBoss, SendOptions } from 'pg-boss';
import { PG_BOSS, QUEUE_NAMES } from '../../queue/queue.constants';
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

/** Retries after 5 s, then about 10 s (pg-boss backs off exponentially). */
const JOB_OPTIONS: SendOptions = {
  retryLimit: INGEST_ATTEMPTS - 1,
  retryDelay: 5,
  retryBackoff: true,
};

/** Queues knowledge for indexing (M2-11, M2-13), with pg-boss. */
@Injectable()
export class KnowledgeIngestQueue {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

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
    const data: IngestJobData = { workspaceId, kind, id };
    await this.boss.send(QUEUE_NAMES.KNOWLEDGE_INGEST, data, JOB_OPTIONS);
  }

  /** Several items in one round trip, e.g. after a CSV import. */
  async enqueueMany(kind: IngestKind, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { workspaceId } = requireTenant();
    await this.boss.insert(
      QUEUE_NAMES.KNOWLEDGE_INGEST,
      ids.map((id) => ({
        data: { workspaceId, kind, id } satisfies IngestJobData,
        ...JOB_OPTIONS,
      })),
    );
  }
}
