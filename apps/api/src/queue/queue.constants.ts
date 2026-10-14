export const QUEUE_NAMES = {
  /** Extract, chunk and embed a knowledge source (M2-11). */
  KNOWLEDGE_INGEST: 'knowledge-ingest',
} as const;

/** Every queue the app uses; created at startup (pg-boss needs that). */
export const ALL_QUEUES = Object.values(QUEUE_NAMES);

/** Injection token for the started pg-boss instance. */
export const PG_BOSS = Symbol('PG_BOSS');
