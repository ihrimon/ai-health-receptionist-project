/**
 * "Verify installation" (FR-3.5, M4-14): which allowed site a widget page
 * load came from. Inside the iframe every API request's Origin is our
 * own, so the site comes from the page request itself: the `Referer` the
 * browser sends for the iframe (the host page's origin under the default
 * referrer policy), else the `?host=` the loader adds (for sites that send
 * no referrer). Both can be faked with curl, so this only drives the
 * dashboard's status, never access (D-2 §4); a site only counts if the
 * `frame-ancestors` CSP would let it frame the page.
 */

const LOCALHOST = /^localhost(?::(\d{1,5}))?$/;

/**
 * Whether `host` (`hostname[:port]`, lowercase) is one the chatbot's
 * `frame-ancestors` allows (see `frameAncestors`): an exact domain or a
 * subdomain of a `*.` entry on the default https port, or localhost
 * outside production (`localhost` = any port, `localhost:3000` = that one).
 */
export function hostAllowed(
  host: string,
  domains: readonly string[],
  allowLocalhost: boolean,
): boolean {
  const local = LOCALHOST.exec(host);
  if (local) {
    if (!allowLocalhost) return false;
    return domains.some((d) => d === 'localhost' || d === host);
  }
  if (host.includes(':')) return false;
  return domains.some((d) =>
    d.startsWith('*.') ? host.endsWith(d.slice(1)) : d === host,
  );
}

/** The host of an http(s) URL the CSP could allow, or null. */
function hostOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost';
  if (url.protocol === 'https:' || (local && url.protocol === 'http:')) {
    return url.host;
  }
  return null;
}

export interface PageRequest {
  referer?: string;
  /** The `?host=` query value the loader sends. */
  hostParam?: unknown;
  /** `Sec-Fetch-Dest`: "iframe" when framed; absent in older browsers. */
  fetchDest?: string;
}

/**
 * The allowed site that framed this page load, or null when it wasn't
 * framed (opened in a tab, `Sec-Fetch-Dest` other than iframe) or no
 * source names an allowed site.
 */
export function embeddingHost(
  req: PageRequest,
  domains: readonly string[],
  allowLocalhost: boolean,
): string | null {
  if (req.fetchDest && req.fetchDest !== 'iframe') return null;
  for (const source of [req.referer, req.hostParam]) {
    const host = hostOf(source);
    if (host && hostAllowed(host, domains, allowLocalhost)) return host;
  }
  return null;
}
