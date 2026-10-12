import { assertTestDatabase, testDatabaseUrl } from './test-db';

// Runs before each test file: point the app (ConfigModule reads
// process.env before .env) at the test database.
const url = testDatabaseUrl();
assertTestDatabase(url);
process.env.DATABASE_URL = url;
