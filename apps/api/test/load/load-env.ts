import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Shared settings of the local load test (M7-5). The test never uses the
 * development database: it has its own database, whose name must end in
 * `_load`, on the same local Postgres.
 */
export const LOAD_APP_ROLE = 'brainstack_app';
export const LOAD_APP_PASSWORD = 'brainstack_app';
export const OUT_DIR = path.resolve(__dirname, '.out');
export const MANIFEST_PATH = path.join(OUT_DIR, 'seed.json');

export interface LoadDatabase {
  /** Owner connection: migrations, pg-boss, seeding. */
  adminUrl: string;
  /** The restricted brainstack_app connection the API runs with (RLS applies). */
  appUrl: string;
  name: string;
}

/**
 * LOAD_DATABASE_URL (owner connection) wins; otherwise the root `.env`'s
 * DATABASE_URL with the database name replaced by `brainstack_load`.
 */
export function loadDatabase(): LoadDatabase {
  config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
  let admin = process.env.LOAD_DATABASE_URL;
  if (!admin) {
    const base = process.env.DATABASE_URL;
    if (!base) throw new Error('Set LOAD_DATABASE_URL or DATABASE_URL');
    const url = new URL(base);
    url.pathname = '/brainstack_load';
    admin = url.toString();
  }
  const url = new URL(admin);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_load')) {
    throw new Error(
      `The load test only runs on a database whose name ends in "_load", not "${name}"`,
    );
  }
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    throw new Error(
      `The load test database must be local, not ${url.hostname}`,
    );
  }
  const app = new URL(admin);
  app.username = LOAD_APP_ROLE;
  app.password = LOAD_APP_PASSWORD;
  return { adminUrl: admin, appUrl: app.toString(), name };
}

/** Env the API (and the seed's app context) must run with. */
export function loadEnv(db: LoadDatabase): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    LOAD_TEST_MODE: 'true',
    // Own bucket name; the load test uploads nothing anyway.
    S3_BUCKET: 'brainstack-load',
    LEAD_NOTIFY_DELAY_SECONDS: process.env.LEAD_NOTIFY_DELAY_SECONDS ?? '0',
  };
}

export interface SeedManifest {
  publicId: string;
  workspaceId: string;
  chatbotId: string;
  database: string;
  chunksInLoadWorkspace: number;
  chunksTotal: number;
  workspaces: number;
  seededAt: string;
}

export function readManifest(): SeedManifest {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      'No seed found: run `pnpm --filter api test:load:seed` first',
    );
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as SeedManifest;
}
