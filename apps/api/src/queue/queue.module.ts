import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PgBoss } from 'pg-boss';
import { ALL_QUEUES, PG_BOSS } from './queue.constants';

@Injectable()
class BossShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  // Graceful: running jobs finish (up to the timeout) before the pool closes.
  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }
}

/**
 * Background jobs in Postgres with pg-boss (no Redis in the MVP, lead's
 * call 2026-10-14). Jobs live in the `pgboss` schema of the app's own
 * database, so the integration tests' jobs stay in the test database.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_BOSS,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<PgBoss> => {
        const logger = new Logger('PgBoss');
        // pg-boss is ESM-only; this app compiles to CommonJS, so it loads
        // with a dynamic import (as @xenova/transformers does).
        const { PgBoss } = await import('pg-boss');
        const boss = new PgBoss({
          connectionString: config.getOrThrow<string>('database.url'),
          ssl: config.get<boolean>('database.ssl')
            ? { rejectUnauthorized: false }
            : undefined,
          schema: 'pgboss',
          max: 4,
        });
        boss.on('error', (err: Error) => logger.error(err.message));
        await boss.start();
        for (const name of ALL_QUEUES) await boss.createQueue(name);
        return boss;
      },
    },
    BossShutdown,
  ],
  exports: [PG_BOSS],
})
export class QueueModule {}
