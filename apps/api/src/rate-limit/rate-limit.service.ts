import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

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

/**
 * Fixed-window counters in Redis, so limits hold across API instances and
 * restarts (M1 decision). Limits come from D-2 §5.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Counts one attempt against every rule and throws RateLimitedException
   * if any of them is now over its limit.
   */
  async consume(...rules: RateLimitRule[]): Promise<void> {
    let retryAfter = 0;
    for (const rule of rules) {
      const key = `ratelimit:${rule.key}`;
      // SET NX starts the window (with its expiry) only on the first hit.
      const results = await this.redis
        .multi()
        .set(key, '0', 'EX', rule.windowSeconds, 'NX')
        .incr(key)
        .ttl(key)
        .exec();
      const count = Number(results?.[1]?.[1]);
      const ttl = Number(results?.[2]?.[1]);
      if (count > rule.limit) {
        retryAfter = Math.max(retryAfter, ttl > 0 ? ttl : rule.windowSeconds);
      }
    }
    if (retryAfter > 0) throw new RateLimitedException(retryAfter);
  }
}
