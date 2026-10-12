import { config } from 'dotenv';
import * as path from 'path';

/**
 * The database integration tests run against. TEST_DATABASE_URL wins
 * (CI sets it); otherwise it's DATABASE_URL from the root .env with
 * "_test" appended to the database name, so a local run never touches
 * the dev database.
 */
export function testDatabaseUrl(): string {
  config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL');
  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  return url.toString();
}

/** Refuses to run against anything that isn't clearly a test database. */
export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Integration tests only run on a *_test database, not "${name}"`,
    );
  }
}
