import { PrismaPg } from '@prisma/adapter-pg';
import { execSync } from 'child_process';
import * as path from 'path';
import { PrismaClient } from '../../src/generated/prisma/client';
import {
  TEST_APP_PASSWORD,
  TEST_APP_ROLE,
  assertTestDatabase,
  testDatabaseUrl,
} from './test-db';

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
    env: { ...process.env, DATABASE_URL: url, DATABASE_ADMIN_URL: url },
    stdio: 'inherit',
  });

  // The migration creates the app role without a login (M7-1); tests give it
  // one so the API can connect as it. Role names are cluster-wide, so a
  // development database on the same server has the role too.
  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
  try {
    const roles = await owner.$queryRaw<{ ok: boolean }[]>`
      SELECT true AS ok FROM pg_roles WHERE rolname = ${TEST_APP_ROLE}`;
    if (roles.length === 0) {
      throw new Error(`The migration did not create the ${TEST_APP_ROLE} role`);
    }
    // Passwords can't be bound as parameters; both values are constants.
    await owner.$executeRawUnsafe(
      `ALTER ROLE ${TEST_APP_ROLE} LOGIN PASSWORD '${TEST_APP_PASSWORD}'`,
    );
  } finally {
    await owner.$disconnect();
  }
}
