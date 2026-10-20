import { parseProcessRole } from '../queue/process-role';
import { usageCostConfigFromEnv } from '../modules/admin/usage-cost';
import { join } from 'path';
import { loadTestConfigFromEnv } from './load-test';
import { assertProductionSecrets } from './required-secrets';

// Stops the API from starting in production without its secrets (M7-27).
export default () => {
  assertProductionSecrets(process.env);
  return buildConfiguration();
};

const buildConfiguration = () => ({
  // Fake LLM + scaled rate limits for the local load test (M7-5); throws at
  // start-up if switched on in production.
  loadTest: loadTestConfigFromEnv(process.env),

  nodeEnv: process.env.NODE_ENV ?? 'development',
  apiPort: parseInt(process.env.API_PORT ?? '3001', 10),
  dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:3000',
  // Script src in the embed snippet (FR-3.1). The loader is built from
  // apps/widget (M4-8). Unset, the dashboard's copy (public/chatbot.js),
  // which opens the dashboard's own /w/:publicId page with no domain
  // check. Set it to <this API's URL>/chatbot.js to switch to the page the
  // API serves with the frame-ancestors CSP (M4-19).
  widgetLoaderUrl:
    process.env.WIDGET_LOADER_URL ??
    `${process.env.DASHBOARD_URL ?? 'http://localhost:3000'}/chatbot.js`,

  // The static build of apps/widget (index.html, assets/, chatbot.js) that
  // the API serves at /w/:publicId (M4-19). The API runs from apps/api.
  widget: {
    distDir:
      process.env.WIDGET_DIST_DIR ??
      join(process.cwd(), '..', 'widget', 'dist'),
  },

  database: {
    // Prisma connects with DATABASE_URL (the Prisma CLI reads it too, via
    // prisma.config.ts). Without it, the URL is built from the POSTGRES_*
    // parts docker-compose uses to create the Postgres container.
    // Row-Level Security (M7-1): in production this is the restricted
    // `brainstack_app` role, which the policies apply to.
    url: process.env.DATABASE_URL ?? buildDatabaseUrl(),
    // The owner/migration role: Prisma migrations and pg-boss (its own
    // `pgboss` schema holds no tenant data). Unset, DATABASE_URL is used for
    // both, which is how local development and the old setup work.
    adminUrl: process.env.DATABASE_ADMIN_URL ?? '',
    // Managed free-tier Postgres (Neon, Supabase, etc.) requires TLS and
    // usually can't present a cert the default Node trust store
    // recognizes — set POSTGRES_SSL=true for those; leave unset for a
    // local/Docker Postgres with no TLS at all.
    ssl: process.env.POSTGRES_SSL === 'true',
    // Most connections the API's pool opens (node-postgres defaults to 10).
    // Every tenant query is its own short transaction, so under load the
    // pool size caps how many requests can be in the database at once
    // (M7-5). Keep it below Postgres max_connections divided by the number
    // of API instances.
    poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10),
  },

  // Background jobs run on pg-boss in the app's own Postgres (no Redis in
  // the MVP). Workers check for new jobs this often when idle.
  queue: {
    // all (default) | api (no workers) | worker (workers only, see worker.ts). M7-7.
    runWorkers: parseProcessRole(process.env.PROCESS_ROLE) !== 'api',
    pollingIntervalSeconds: parseFloat(
      process.env.QUEUE_POLLING_INTERVAL_SECONDS ?? '2',
    ),
  },

  // New-lead email to the workspace owners (M5-6). The job waits this long
  // after a lead is first saved, so details the visitor gives a moment
  // later (the email after the name) are in the same, single email.
  leads: {
    notifyDelaySeconds: parseFloat(
      process.env.LEAD_NOTIFY_DELAY_SECONDS ?? '60',
    ),
  },

  // LLM API key(s) + model are no longer read from env — they're managed
  // at runtime via the admin Settings page (llm_credentials table,
  // LlmCredentialsService/LlmKeyManager) so they can be edited without a
  // redeploy and aren't tied to a single provider like Groq.

  // S3-compatible file storage (M0 decision T9): MinIO locally (see
  // docker-compose.yml), Cloudflare R2 or AWS S3 in production. The
  // defaults match the local MinIO container.
  storage: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? 'brainstack-local',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'brainstack',
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY ?? 'brainstack-dev-secret',
    // MinIO needs path-style URLs (endpoint/bucket/key); R2 and S3 don't.
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    // Create the bucket on first upload if it's missing: handy for a fresh
    // local MinIO. Off by default in production, where buckets come with
    // the hosting setup (M7).
    createBucket:
      (process.env.S3_CREATE_BUCKET ??
        String(process.env.NODE_ENV !== 'production')) === 'true',
  },

  // Encrypts workspaces' own LLM API keys at rest (M3-21). Generate with
  // `openssl rand -base64 32`; required in production. Development and
  // tests fall back to a fixed key, so local data isn't protected by it.
  security: {
    llmKeyEncryptionKey: process.env.LLM_KEY_ENCRYPTION_KEY ?? '',
    // Signs the public chat's conversation tokens (M3-4). Generate with
    // `openssl rand -base64 32`; required in production, where public
    // chat answers 503 without it.
    conversationTokenSecret: process.env.CONVERSATION_TOKEN_SECRET ?? '',
  },

  // Price assumptions for the platform-admin usage and cost view (M6-12).
  // Estimates only; see modules/admin/usage-cost.ts.
  adminUsage: usageCostConfigFromEnv(process.env),

  knowledge: {
    embeddingModel:
      process.env.KNOWLEDGE_EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
    topK: parseInt(process.env.KNOWLEDGE_TOP_K ?? '5', 10),
    // A chunk counts as relevant to a question when it matches one of its
    // words or its cosine similarity is at least this (M3-10).
    minSimilarity: parseFloat(process.env.KNOWLEDGE_MIN_SIMILARITY ?? '0.3'),
    // A question this close to a custom answer's trigger question gets
    // that answer as it is (M3-6).
    customAnswerThreshold: parseFloat(
      process.env.KNOWLEDGE_CUSTOM_ANSWER_THRESHOLD ?? '0.7',
    ),
  },

  // Transactional email, sent via a plain Gmail account (SMTP through
  // nodemailer's "gmail" service preset) for local development — no
  // domain/DNS setup needed. Requires 2-Step Verification enabled on that
  // Gmail account and an "App Password" (myaccount.google.com/apppasswords),
  // NOT the account's normal login password. Left unset, EmailService logs
  // once and no-ops. Production moves to Resend (M0 decision T10).
  email: {
    // Verification and password-reset mail (M7-37). Off until a mail provider
    // is chosen: signup then marks the email verified and sends nothing, so
    // it does not wait on SMTP. Switch on with EMAIL_FEATURES_ENABLED=true
    // (and NEXT_PUBLIC_EMAIL_FEATURES_ENABLED=true in the dashboard).
    featuresEnabled: process.env.EMAIL_FEATURES_ENABLED === 'true',
    gmailUser: process.env.EMAIL_USER ?? '',
    gmailAppPassword: process.env.EMAIL_APP_PASSWORD ?? '',
    fromName: process.env.EMAIL_FROM_NAME ?? 'BrainStack AI Receptionist',
  },
});

function buildDatabaseUrl(): string {
  const user = encodeURIComponent(process.env.POSTGRES_USER ?? 'brainstack');
  const password = encodeURIComponent(
    process.env.POSTGRES_PASSWORD ?? 'brainstack',
  );
  const host = process.env.POSTGRES_HOST ?? 'localhost';
  // The compose file's host port (see .env.example for why not 5432).
  const port = process.env.POSTGRES_PORT ?? '55432';
  const name = process.env.POSTGRES_DB ?? 'brainstack_booking';
  return `postgresql://${user}:${password}@${host}:${port}/${name}`;
}
