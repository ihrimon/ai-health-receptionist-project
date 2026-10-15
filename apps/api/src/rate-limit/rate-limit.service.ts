import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface RateLimitRule {
  /** Counter name, e.g. `login:ip-email:1.2.3.4:a@b.com`. */
  key: string;
  limit: number;
  windowSeconds: number;
}

/** 429 carrying the seconds until the window resets (D-2 §1). */
export class RateLimitedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      'Too many attempts. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** About one call in a hundred also deletes expired windows. */
const CLEANUP_CHANCE = 0.01;

/**
 * Fixed-window counters in Postgres (`rate_limits`), so limits hold across
 * API instances and restarts. They lived in Redis until the MVP dropped it
 * (lead's call, 2026-10-14). Limits come from D-2 §5.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  /** Replaceable in tests. */
  now: () => number = Date.now;
  random: () => number = Math.random;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Counts one attempt against every rule and throws RateLimitedException
   * if any of them is now over its limit.
   */
  async consume(...rules: RateLimitRule[]): Promise<void> {
    const now = this.now();
    let retryAfter = 0;
    for (const rule of rules) {
      const windowMs = rule.windowSeconds * 1000;
      const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
      const expiresAt = new Date(windowStart.getTime() + windowMs);
      // One atomic INSERT … ON CONFLICT DO UPDATE in Postgres, so
      // concurrent attempts can't both read the old count.
      const { count } = await this.prisma.rateLimit.upsert({
        where: { key_windowStart: { key: rule.key, windowStart } },
        create: { key: rule.key, windowStart, expiresAt, count: 1 },
        update: { count: { increment: 1 } },
        select: { count: true },
      });
      if (count > rule.limit) {
        const left = Math.ceil((expiresAt.getTime() - now) / 1000);
        retryAfter = Math.max(retryAfter, Math.max(left, 1));
      }
    }
    if (this.random() < CLEANUP_CHANCE) this.deleteExpired(now);
    if (retryAfter > 0) throw new RateLimitedException(retryAfter);
  }

  /** Fire and forget: a failed cleanup just waits for the next one. */
  private deleteExpired(now: number): void {
    this.prisma.rateLimit
      .deleteMany({ where: { expiresAt: { lt: new Date(now) } } })
      .catch((err: Error) =>
        this.logger.warn(
          `Could not delete expired rate limits: ${err.message}`,
        ),
      );
  }
}
