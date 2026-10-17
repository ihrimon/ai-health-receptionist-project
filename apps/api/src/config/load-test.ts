/**
 * Load-test mode (M7-5): a fake LLM provider and scaled-up public-chat rate
 * limits, so a local load test costs nothing and is not stopped by the
 * limits a single machine would hit. It exists only for tests: turning it on
 * while NODE_ENV is "production" stops the API from starting.
 */
export interface LoadTestConfig {
  enabled: boolean;
  /** Public-chat rate limits are multiplied by this (>= 1). */
  rateLimitFactor: number;
  /** Fake LLM: delay before the first token, per token, and tokens per answer. */
  fakeFirstTokenMs: number;
  fakeTokenMs: number;
  fakeTokens: number;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function number(value: string | undefined, fallback: number, min = 0): number {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

export function loadTestConfigFromEnv(env: NodeJS.ProcessEnv): LoadTestConfig {
  const enabled = TRUE_VALUES.has(
    (env.LOAD_TEST_MODE ?? '').trim().toLowerCase(),
  );
  const production = (env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
  if (enabled && production) {
    throw new Error(
      'LOAD_TEST_MODE (fake LLM provider) must never be enabled when NODE_ENV=production',
    );
  }
  return {
    enabled,
    rateLimitFactor: number(env.LOAD_TEST_RATE_LIMIT_FACTOR, 1, 1),
    fakeFirstTokenMs: number(env.LOAD_TEST_FAKE_FIRST_TOKEN_MS, 300),
    fakeTokenMs: number(env.LOAD_TEST_FAKE_TOKEN_MS, 20),
    fakeTokens: Math.floor(number(env.LOAD_TEST_FAKE_TOKENS, 40, 1)),
  };
}
