import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { RateLimitService } from './rate-limit.service';
import { RateLimitedFilter } from './rate-limited.filter';

@Global()
@Module({
  providers: [
    RateLimitService,
    { provide: APP_FILTER, useClass: RateLimitedFilter },
  ],
  exports: [RateLimitService],
})
export class RateLimitModule {}
