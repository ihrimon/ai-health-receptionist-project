/**
 * Secrets the API cannot run safely without in production (M7-27). Locally and
 * in tests a fixed development value is used instead, so only NODE_ENV=production
 * is checked, and the API refuses to start when one is missing.
 */
const REQUIRED_IN_PRODUCTION = [
  'LLM_KEY_ENCRYPTION_KEY',
  'CONVERSATION_TOKEN_SECRET',
] as const;

export function assertProductionSecrets(env: NodeJS.ProcessEnv): void {
  if ((env.NODE_ENV ?? '').trim().toLowerCase() !== 'production') return;
  const missing = REQUIRED_IN_PRODUCTION.filter(
    (name) => !(env[name] ?? '').trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s) in production: ${missing.join(', ')}. ` +
        'Generate each with `openssl rand -base64 32` and set it before starting the API.',
    );
  }
}
