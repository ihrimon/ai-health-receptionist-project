/**
 * A `next` query param that is safe to redirect to: a same-site path only.
 * Browsers treat a backslash like a slash and ignore tabs and line breaks
 * inside a URL, so `/\evil.com` and `/<tab>/evil.com` would both leave the
 * site; anything with such characters falls back to the dashboard (M7-2).
 */
export function safeNext(next: string | null): string {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !/[\\\u0000-\u001f\u007f]/.test(next)
  ) {
    return next;
  }
  return "/app";
}
