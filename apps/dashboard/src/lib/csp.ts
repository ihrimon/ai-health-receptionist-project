/**
 * Content-Security-Policy builder (M7-26). The proxy (src/proxy.ts) makes a
 * fresh nonce per request and calls this; Next.js reads the nonce back from
 * the request's CSP header and stamps it on its own inline scripts, so
 * production needs no 'unsafe-inline' for scripts.
 */
export interface CspOptions {
  nonce: string;
  isDev: boolean;
  /** The API's origin, the only other place the page may send data. */
  apiOrigin: string;
}

export function buildCsp({ nonce, isDev, apiOrigin }: CspOptions): string {
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets the nonced Next.js bootstrap load its chunks.
    // Dev needs 'unsafe-eval' (React debugging); production must not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

/**
 * The fallback widget page (/w/:publicId) is framed by companies on their
 * own sites, so it gets no CSP and no frame blocking here.
 */
export function isWidgetPath(pathname: string): boolean {
  return pathname === "/w" || pathname.startsWith("/w/");
}
