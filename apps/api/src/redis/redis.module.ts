import {
  Global,
  Inject,
  Injectable,
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
    await this.redis.quit();
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
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
          tls: config.get<boolean>('redis.tls') ? {} : undefined,
          // Fail fast instead of queueing commands while Redis is down, so
          // requests error out rather than hang.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        }),
    },
    RedisShutdown,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
