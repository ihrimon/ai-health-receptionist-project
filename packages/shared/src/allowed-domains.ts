/**
 * The chatbot's embed allow-list (FR-3.4, D-2 §2.2): the sites allowed to
 * show the widget. Shared so the dashboard shows the same errors the API
 * enforces (`PUT /v1/chatbot/allowed-domains`). Enforced on the widget
 * page with a `frame-ancestors` CSP header (D-2 §4, M4-19).
 */

/** Most sites a company could need; keeps the CSP header short. */
export const MAX_ALLOWED_DOMAINS = 20;

// One DNS label: letters, digits and inner hyphens, at most 63 characters.
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
// Top-level domain: letters, or punycode for internationalized ones.
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const LOCALHOST = /^localhost(?::\d{1,5})?$/;

export interface DomainProblem {
  /** The (normalized) domain, or '' for a problem with the whole list. */
  domain: string;
  message: string;
}

export type DomainCheck =
  { ok: true; domains: string[] } | { ok: false; problems: DomainProblem[] };

/**
 * What we store for one typed or pasted entry: trimmed, lowercased, without
 * an `http(s)://` prefix or a trailing `/` (people paste their site's
 * address). Paths and ports are left in, so the check rejects them.
 */
export function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

/** Why one normalized entry isn't allowed, or null if it is. */
export function domainProblem(
  host: string,
  allowLocalhost: boolean,
): string | null {
  if (LOCALHOST.test(host)) {
    return allowLocalhost ? null : 'localhost is only allowed in development';
  }
  if (/[/:?#@\s]/.test(host)) {
    return 'Use only the domain name, e.g. shop.example.com (no paths or ports)';
  }
  const wildcard = host.startsWith('*.');
  const labels = (wildcard ? host.slice(2) : host).split('.');
  const valid =
    host.length <= 253 &&
    labels.length >= 2 &&
    labels.every((l) => LABEL.test(l)) &&
    TLD.test(labels.at(-1)!);
  return valid ? null : 'Must be a domain like example.com or *.example.com';
}

/**
 * Validates the whole list: `example.com` or `*.example.com`, plus
 * `localhost[:port]` outside production. Returns the domains normalized and
 * de-duplicated, in the given order; blank entries are dropped.
 */
export function checkAllowedDomains(
  input: string[],
  allowLocalhost: boolean,
): DomainCheck {
  const domains = [...new Set(input.map(normalizeDomain).filter(Boolean))];
  const problems: DomainProblem[] = [];
  for (const domain of domains) {
    const message = domainProblem(domain, allowLocalhost);
    if (message) problems.push({ domain, message });
  }
  if (domains.length > MAX_ALLOWED_DOMAINS) {
    problems.push({
      domain: '',
      message: `At most ${MAX_ALLOWED_DOMAINS} domains`,
    });
  }
  return problems.length ? { ok: false, problems } : { ok: true, domains };
}
