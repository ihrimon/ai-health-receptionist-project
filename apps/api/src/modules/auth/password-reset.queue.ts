import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PgBoss, SendOptions } from 'pg-boss';
import { PG_BOSS, QUEUE_NAMES } from '../../queue/queue.constants';

export interface PasswordResetJobData {
  /** Already normalised by the DTO. No token here: the worker makes it. */
  email: string;
}

/** Attempts per job before the email is given up. */
export const PASSWORD_RESET_ATTEMPTS = 3;

const JOB_OPTIONS: SendOptions = {
  retryLimit: PASSWORD_RESET_ATTEMPTS - 1,
  retryDelay: 15,
  retryBackoff: true,
};

/**
 * Queues the password-reset email on pg-boss (M7-24), so the forgot-password
 * answer takes the same time whether or not the address has an account.
 */
@Injectable()
export class PasswordResetQueue {
  private readonly logger = new Logger(PasswordResetQueue.name);

  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  /**
   * Never throws: a queue error must not turn into a different answer
   * (which would tell a caller something), so it is only logged.
   */
  async enqueue(email: string): Promise<void> {
    const data: PasswordResetJobData = { email };
    try {
      await this.boss.send(QUEUE_NAMES.PASSWORD_RESET, data, JOB_OPTIONS);
    } catch (err) {
      this.logger.error(
        `Could not queue a password-reset email: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
