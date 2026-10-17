import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PgBoss, SendOptions } from 'pg-boss';
import { PG_BOSS, QUEUE_NAMES } from '../../queue/queue.constants';

export interface LeadNotifyJobData {
  /** The job runs outside any request, so it carries its workspace. */
  workspaceId: string;
  leadId: string;
}

/** Attempts per job before the email is given up. */
export const LEAD_NOTIFY_ATTEMPTS = 5;

/** Retries after 30 s, then about 1, 2 and 4 minutes (exponential backoff). */
const JOB_OPTIONS: SendOptions = {
  retryLimit: LEAD_NOTIFY_ATTEMPTS - 1,
  retryDelay: 30,
  retryBackoff: true,
};

/** Queues the new-lead email to the workspace owners (M5-6), on pg-boss. */
@Injectable()
export class LeadNotifyQueue {
  private readonly logger = new Logger(LeadNotifyQueue.name);

  constructor(
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly config: ConfigService,
  ) {}

  /**
   * Never throws: a lead is saved even when the job can't be queued (the
   * chat must not break over an email). The job starts after the
   * configured delay, so details the visitor adds right after are in it.
   */
  async enqueue(workspaceId: string, leadId: string): Promise<void> {
    const data: LeadNotifyJobData = { workspaceId, leadId };
    try {
      await this.boss.send(QUEUE_NAMES.LEAD_NOTIFY, data, {
        ...JOB_OPTIONS,
        startAfter: Math.max(
          0,
          Math.round(this.config.get<number>('leads.notifyDelaySeconds') ?? 60),
        ),
      });
    } catch (err) {
      this.logger.error(
        `Could not queue the new-lead email for lead ${leadId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
