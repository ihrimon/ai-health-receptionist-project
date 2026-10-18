import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PgBoss } from 'pg-boss';
import { WorkspaceRole } from '../../generated/prisma/client';
import { runsWorkers } from '../../queue/process-role';
import { PG_BOSS, QUEUE_NAMES } from '../../queue/queue.constants';
import { runWithTenant } from '../../tenancy/tenant-context';
import { IngestError } from './ingest-error';
import { type IngestJobData, INGEST_ATTEMPTS } from './knowledge-ingest.queue';
import {
  INGEST_FAILED_MESSAGE,
  KnowledgeIngestService,
} from './knowledge-ingest.service';

/** What a worker needs of a pg-boss job. */
export interface IngestJob {
  data: IngestJobData;
  /** 0 on the first attempt, 1 on the first retry, … */
  retryCount: number;
}

/**
 * Runs `knowledge-ingest` jobs (M2-11) inside the API process for now; a
 * separate worker process comes with M7-7. One at a time: embedding is
 * CPU-heavy and runs on the same machine as the API.
 */
@Injectable()
export class KnowledgeIngestProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeIngestProcessor.name);

  constructor(
    private readonly ingest: KnowledgeIngestService,
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // API-only process (PROCESS_ROLE=api, M7-7): jobs are queued but run elsewhere.
    if (!runsWorkers(this.config)) return;
    await this.boss.work<IngestJobData>(
      QUEUE_NAMES.KNOWLEDGE_INGEST,
      {
        batchSize: 1,
        localConcurrency: 1,
        pollingIntervalSeconds:
          this.config.get<number>('queue.pollingIntervalSeconds') ?? 2,
      },
      async (jobs) => {
        for (const job of jobs) await this.process(job);
      },
    );
  }

  /** Throws to let pg-boss retry the job with backoff. */
  async process(job: IngestJob): Promise<void> {
    const { workspaceId, kind, id } = job.data;
    const attempt = job.retryCount + 1;
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
          if (attempt >= INGEST_ATTEMPTS) {
            await this.ingest.fail(kind, id, INGEST_FAILED_MESSAGE);
          }
          this.logger.error(
            `Indexing ${kind} ${id} failed (attempt ${attempt}/${INGEST_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      },
    );
  }
}
