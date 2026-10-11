export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  apiPort: parseInt(process.env.API_PORT ?? '3001', 10),
  dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:3000',

  database: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    username: process.env.POSTGRES_USER ?? 'brainstack',
    password: process.env.POSTGRES_PASSWORD ?? 'brainstack',
    name: process.env.POSTGRES_DB ?? 'brainstack_booking',
    // Managed free-tier Postgres (Neon, Supabase, etc.) requires TLS and
    // usually can't present a cert the default Node trust store
    // recognizes — set POSTGRES_SSL=true for those; leave unset for a
    // local/Docker Postgres with no TLS at all.
    ssl: process.env.POSTGRES_SSL === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    // Managed free-tier Redis (Upstash, Redis Cloud, etc.) requires a
    // password and TLS; a local/Docker Redis typically has neither.
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true',
  },

  // LLM API key(s) + model are no longer read from env — they're managed
  // at runtime via the admin Settings page (llm_credentials table,
  // LlmCredentialsService/LlmKeyManager) so they can be edited without a
  // redeploy and aren't tied to a single provider like Groq.

  knowledge: {
    embeddingModel:
      process.env.KNOWLEDGE_EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
    topK: parseInt(process.env.KNOWLEDGE_TOP_K ?? '3', 10),
  },

  admin: {
    password: process.env.ADMIN_PASSWORD ?? '',
    sessionSecret: process.env.ADMIN_SESSION_SECRET ?? '',
  },

  // Transactional email, sent via a plain Gmail account (SMTP through
  // nodemailer's "gmail" service preset) for local development — no
  // domain/DNS setup needed. Requires 2-Step Verification enabled on that
  // Gmail account and an "App Password" (myaccount.google.com/apppasswords),
  // NOT the account's normal login password. Left unset, EmailService logs
  // once and no-ops. Production moves to Resend (M0 decision T10).
  email: {
    gmailUser: process.env.EMAIL_USER ?? '',
    gmailAppPassword: process.env.EMAIL_APP_PASSWORD ?? '',
    fromName: process.env.EMAIL_FROM_NAME ?? 'BrainStack AI Receptionist',
  },
});
