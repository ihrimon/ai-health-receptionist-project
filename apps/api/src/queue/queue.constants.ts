export const QUEUE_NAMES = {
  /** Extract, chunk and embed a knowledge source (M2-11). */
  KNOWLEDGE_INGEST: 'knowledge-ingest',
  /** Email the workspace owners about a new lead (M5-6). */
  LEAD_NOTIFY: 'lead-notify',
  /** Look up the account and email a password-reset link (M7-24). */
  PASSWORD_RESET: 'password-reset',
} as const;

/** Every queue the app uses; created at startup (pg-boss needs that). */
export const ALL_QUEUES = Object.values(QUEUE_NAMES);

/** Injection token for the started pg-boss instance. */
export const PG_BOSS = Symbol('PG_BOSS');
