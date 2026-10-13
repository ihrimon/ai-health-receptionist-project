/** Most sites a company could need; keeps the CSP header short (M4). */
export const MAX_ALLOWED_DOMAINS = 20;

// One DNS label: letters, digits and inner hyphens, at most 63 characters.
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
// Top-level domain: letters, or punycode for internationalized ones.
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const LOCALHOST = /^localhost(?::\d{1,5})?$/;

export interface DomainProblem {
  domain: string;
  message: string;
}

export type DomainCheck =
  { ok: true; domains: string[] } | { ok: false; problems: DomainProblem[] };

function checkHost(host: string, allowLocalhost: boolean): string | null {
  if (LOCALHOST.test(host)) {
    return allowLocalhost ? null : 'localhost is only allowed in development';
  }
  const wildcard = host.startsWith('*.');
  const labels = (wildcard ? host.slice(2) : host).split('.');
  if (host.length > 253 || labels.length < 2) {
    return 'Must be a domain like example.com or *.example.com';
  }
  if (!labels.every((l) => LABEL.test(l)) || !TLD.test(labels.at(-1)!)) {
    return 'Use only the domain name, e.g. shop.example.com (no https:// or paths)';
  }
  return null;
}

/**
 * Validates the widget's embed allow-list (D-2 §2.2): `example.com` or
 * `*.example.com`, plus `localhost[:port]` outside production. Returns the
 * domains trimmed, lowercased and de-duplicated, in the given order.
 */
export function checkAllowedDomains(
  input: string[],
  allowLocalhost: boolean,
): DomainCheck {
  const domains = [
    ...new Set(input.map((d) => d.trim().toLowerCase()).filter(Boolean)),
  ];
  const problems: DomainProblem[] = [];
  for (const domain of domains) {
    const message = checkHost(domain, allowLocalhost);
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
