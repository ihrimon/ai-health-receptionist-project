import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '../../src/generated/prisma/client';
import { assertTestDatabase, testDatabaseUrl } from './test-db';

/**
 * Creates the test database if needed and applies all migrations to it,
 * so `pnpm --filter api test:integration` works on a fresh machine.
 */
export default async function globalSetup(): Promise<void> {
  const url = testDatabaseUrl();
  assertTestDatabase(url);

  const name = new URL(url).pathname.replace(/^\//, '');
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: maintenance.toString() }),
  });
  try {
    const rows = await admin.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${name}) AS exists`;
    if (!rows[0]?.exists) {
      // Identifiers can't be bound as parameters; the name was checked to
      // end in _test and comes from our own config.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
