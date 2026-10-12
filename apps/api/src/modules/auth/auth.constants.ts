/** httpOnly session cookie (D-2 §1). Holds the raw token; the DB has its hash. */
export const SESSION_COOKIE = 'bs_session';

const HOUR_MS = 60 * 60 * 1000;

export const SESSION_TTL_MS = 7 * 24 * HOUR_MS;
export const VERIFY_EMAIL_TTL_MS = 24 * HOUR_MS;
export const RESET_PASSWORD_TTL_MS = HOUR_MS;

/** Metadata key set by @Public(). */
export const IS_PUBLIC_KEY = 'auth:isPublic';
