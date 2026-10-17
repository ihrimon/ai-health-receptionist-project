import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PgBoss } from 'pg-boss';
import { WorkspaceRole } from '../../generated/prisma/client';
import { PG_BOSS, QUEUE_NAMES } from '../../queue/queue.constants';
import { runWithTenant } from '../../tenancy/tenant-context';
import {
  LEAD_NOTIFY_ATTEMPTS,
  type LeadNotifyJobData,
} from './lead-notify.queue';
import {
  type LeadNotifyResult,
  LeadNotifyService,
} from './lead-notify.service';

/** What a worker needs of a pg-boss job. */
export interface LeadNotifyJob {
  data: LeadNotifyJobData;
  /** 0 on the first attempt, 1 on the first retry, … */
  retryCount: number;
}

/**
 * Runs `lead-notify` jobs (M5-6) in the API process, next to the chat.
 * A failed send throws, so pg-boss retries it with backoff; the chat that
 * saved the lead finished long before and never sees the error.
 */
@Injectable()
export class LeadNotifyProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(LeadNotifyProcessor.name);

  constructor(
    private readonly notifier: LeadNotifyService,
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.work<LeadNotifyJobData>(
      QUEUE_NAMES.LEAD_NOTIFY,
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

  async process(job: LeadNotifyJob): Promise<LeadNotifyResult> {
    const { workspaceId, leadId } = job.data;
    const attempt = job.retryCount + 1;
    // No request here, so the job sets the workspace context itself; the
    // tenant client then only finds this workspace's lead and owners.
    return runWithTenant(
      { workspaceId, userId: 'system:lead-notify', role: WorkspaceRole.OWNER },
      async () => {
        try {
          return await this.notifier.notify(leadId);
        } catch (err) {
          this.logger.error(
            `New-lead email for lead ${leadId} failed (attempt ${attempt}/${LEAD_NOTIFY_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      },
    );
  }
}
