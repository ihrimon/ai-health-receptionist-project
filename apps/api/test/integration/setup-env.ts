import { assertTestDatabase, testDatabaseUrl } from './test-db';

// Runs before each test file: point the app (ConfigModule reads
// process.env before .env) at the test database.
const url = testDatabaseUrl();
assertTestDatabase(url);
process.env.DATABASE_URL = url;

// Uploads go to their own bucket, created on first use, so tests never
// mix with files from local development.
process.env.S3_BUCKET = 'brainstack-test';
process.env.S3_CREATE_BUCKET = 'true';

// Background jobs (pg-boss) live in the test database; poll often so
// tests that wait for indexing finish quickly.
process.env.QUEUE_POLLING_INTERVAL_SECONDS = '0.5';
