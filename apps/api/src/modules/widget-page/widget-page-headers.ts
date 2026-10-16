/**
 * Response headers of the widget page `/w/:publicId` (M4-19, D-2 §4).
 *
 * `frame-ancestors` is the domain protection: the browser itself refuses
 * to show the page in an iframe on a site that isn't on the chatbot's
 * allow-list. The API can't do this check, because inside the iframe every
 * request's Origin is our own.
 */

/**
 * The `frame-ancestors` sources for a chatbot's allowed domains (rules in
 * `@brainstack/shared` allowed-domains.ts): `shop.example.com` →
 * `https://shop.example.com`, `*.example.com` → `https://*.example.com`
 * (subdomains only, like the rule), `localhost[:port]` → http and https on
 * that port (any port without one) outside production, dropped in
 * production. An empty list is `'none'`: the page can't be framed at all.
 */
export function frameAncestors(
  domains: readonly string[],
  allowLocalhost: boolean,
): string {
  const sources: string[] = [];
  for (const domain of domains) {
    if (/^localhost(?::\d+)?$/.test(domain)) {
      if (!allowLocalhost) continue;
      const host = domain.includes(':') ? domain : `${domain}:*`;
      sources.push(`http://${host}`, `https://${host}`);
    } else if (/^(?:\*\.)?[a-z0-9.-]+$/.test(domain)) {
      // Stored domains passed the shared check; anything else (a row
      // edited by hand) is skipped so it can't inject a directive.
      sources.push(`https://${domain}`);
    }
  }
  return sources.length ? [...new Set(sources)].join(' ') : "'none'";
}

/**
 * Headers for the chat page. Scripts, styles and fonts only from our own
 * origin (the widget build has no inline script), and the API on the same
 * origin (a widget built without `VITE_API_URL` calls its own origin);
 * images also from https (an avatar on file storage) and data: URLs.
 */
export function widgetPageHeaders(ancestors: string): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self' https: data:",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${ancestors}`,
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // The CSP changes as soon as the company edits its list, so the
    // browser must ask again every time; the server-side cache is short.
    'Cache-Control': 'no-cache',
    'Content-Type': 'text/html; charset=utf-8',
  };
}

/**
 * The page for an unknown, unpublished or switched-off chatbot (404). No
 * script and nothing to click, so it may show in any frame: the visitor
 * sees a short note instead of a broken frame.
 */
export const NOT_FOUND_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Chat unavailable</title>
<style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font:14px/1.4 system-ui,sans-serif;color:#52525b;background:#fff;text-align:center;padding:16px;box-sizing:border-box}</style>
</head><body><p>This chat isn't available right now.</p></body></html>
`;

export const NOT_FOUND_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
  'Content-Type': 'text/html; charset=utf-8',
};
