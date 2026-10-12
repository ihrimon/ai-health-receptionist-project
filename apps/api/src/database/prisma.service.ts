import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * The app's single database client. Prisma 7 talks to Postgres through a
 * driver adapter (node-postgres here) instead of a bundled query engine.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get<string>('database.url'),
        // Managed Postgres (Neon, Supabase…) needs TLS with a cert Node's
        // default trust store usually can't verify — see POSTGRES_SSL.
        ssl: config.get<boolean>('database.ssl')
          ? { rejectUnauthorized: false }
          : undefined,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
