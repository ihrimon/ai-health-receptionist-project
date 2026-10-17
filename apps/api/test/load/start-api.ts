import { spawn } from 'child_process';
import * as path from 'path';
import { loadDatabase, loadEnv } from './load-env';

/**
 * Starts the built API (apps/api/dist/main.js; run `pnpm --filter api build`
 * first) against the load-test database in load-test mode (M7-5): the fake
 * LLM provider, scaled public-chat rate limits and the restricted
 * `brainstack_app` database role, so Row-Level Security is part of the
 * measurement. Extra settings come from the environment, for example
 * LOAD_TEST_RATE_LIMIT_FACTOR, LOAD_TEST_FAKE_FIRST_TOKEN_MS and
 * DATABASE_POOL_MAX.
 */
const db = loadDatabase();
const env = loadEnv(db);
env.API_PORT = process.env.LOAD_API_PORT ?? '3101';
env.LOAD_TEST_RATE_LIMIT_FACTOR ??= '1000';

const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: path.resolve(__dirname, '../..'),
  env,
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
