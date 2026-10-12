import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { RateLimitedException } from './rate-limit.service';

/** Adds the `Retry-After` header D-2 §1 requires on every 429. */
@Catch(RateLimitedException)
export class RateLimitedFilter implements ExceptionFilter {
  catch(exception: RateLimitedException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    res
      .status(exception.getStatus())
      .setHeader('Retry-After', String(exception.retryAfterSeconds))
      .json(exception.getResponse());
  }
}
