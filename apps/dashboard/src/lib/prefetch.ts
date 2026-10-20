/**
 * Starts requests before the page that needs them has rendered (M7-37).
 *
 * The dashboard first asks "who am I?" (`/auth/me`) and only then renders
 * the page, which used to start about ten more requests: two round trips
 * in a row, each with a CORS preflight. A prefetched request starts at the
 * same moment as `/auth/me`; the page then takes the answer that is already
 * on its way instead of asking again.
 *
 * An entry is taken once (the next request is a fresh one, so refreshing
 * after a change never reads old data) and goes stale after a short while.
 */
const MAX_AGE_MS = 15_000;

/** Keys the Overview page uses to pick up what was started early. */
export const overviewKey = {
  chatbot: "chatbot",
  analytics: (days: number) => `analytics:${days}`,
  topQuestions: (days: number) => `top-questions:${days}`,
  faqs: "faqs",
  sources: "sources",
  products: "products:1",
};

const pending = new Map<string, { promise: Promise<unknown>; at: number }>();

export function prefetch(
  key: string,
  start: () => Promise<unknown>,
  now = Date.now(),
): void {
  const existing = pending.get(key);
  if (existing && now - existing.at <= MAX_AGE_MS) return;
  const promise = start();
  // A failed prefetch is reported to whoever takes it, not as an unhandled error.
  promise.catch(() => undefined);
  pending.set(key, { promise, at: now });
}

/** The prefetched answer if one is fresh, else a new request. */
export function takeOrFetch<T>(
  key: string,
  start: () => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const hit = pending.get(key);
  pending.delete(key);
  if (hit && now - hit.at <= MAX_AGE_MS) return hit.promise as Promise<T>;
  return start();
}

/** Forgets everything (tests, and after signing out). */
export function clearPrefetched(): void {
  pending.clear();
}
