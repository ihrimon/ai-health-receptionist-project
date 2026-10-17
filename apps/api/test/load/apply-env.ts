import { loadDatabase, loadEnv } from './load-env';

/**
 * Import this FIRST in a script that loads AppModule: the app reads its
 * configuration (database URLs, load-test mode) when its modules are
 * imported, so the environment has to be set before that.
 */
export const LOAD_DB = loadDatabase();
Object.assign(process.env, loadEnv(LOAD_DB));
