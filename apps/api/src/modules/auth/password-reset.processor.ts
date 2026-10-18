import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PgBoss } from 'pg-boss';
import { runsWorkers } from '../../queue/process-role';
import { PG_BOSS, QUEUE_NAMES } from '../../queue/queue.constants';
import { AuthService } from './auth.service';
import {
  PASSWORD_RESET_ATTEMPTS,
  type PasswordResetJobData,
} from './password-reset.queue';

/** What a worker needs of a pg-boss job. */
export interface PasswordResetJob {
  data: PasswordResetJobData;
  /** 0 on the first attempt, 1 on the first retry, … */
  retryCount: number;
}

/** Runs `password-reset` jobs (M7-24) in the API process. */
@Injectable()
export class PasswordResetProcessor implements OnApplicationBootstrap {
  private readonly logger = new Logger(PasswordResetProcessor.name);

  constructor(
    private readonly auth: AuthService,
    @Inject(PG_BOSS) private readonly boss: PgBoss,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // API-only process (PROCESS_ROLE=api, M7-7): jobs are queued but run elsewhere.
    if (!runsWorkers(this.config)) return;
    await this.boss.work<PasswordResetJobData>(
      QUEUE_NAMES.PASSWORD_RESET,
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

  async process(job: PasswordResetJob): Promise<void> {
    try {
      await this.auth.sendPasswordReset(job.data.email);
    } catch (err) {
      // The address is not logged: it may be a real account.
      this.logger.error(
        `Password-reset email failed (attempt ${job.retryCount + 1}/${PASSWORD_RESET_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
