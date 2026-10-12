import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Injectable()
class RedisShutdown implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    // quit() needs a live connection; if Redis never came up, just drop it.
    if (this.redis.status === 'ready') await this.redis.quit();
    else this.redis.disconnect();
  }
}

/**
 * Plain Redis client for app state (rate-limit counters, M1-18). BullMQ
 * opens its own connections in QueueModule; this one is separate so a slow
 * queue never blocks a login.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = new Redis({
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
          tls: config.get<boolean>('redis.tls') ? {} : undefined,
          // Fail fast instead of queueing commands while Redis is down, so
          // requests error out rather than hang.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        });
        // ioredis reconnects on its own; without a listener every failed
        // attempt is logged as an "Unhandled error event".
        const logger = new Logger('Redis');
        // "localhost" tries IPv4 and IPv6, so a refused connection arrives as
        // an AggregateError with an empty message; its code is still set.
        redis.on('error', (err: NodeJS.ErrnoException) =>
          logger.warn(`Connection error: ${err.code ?? err.message}`),
        );
        return redis;
      },
    },
    RedisShutdown,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
