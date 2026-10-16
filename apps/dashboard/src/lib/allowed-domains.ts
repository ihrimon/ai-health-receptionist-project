import {
  domainProblem,
  MAX_ALLOWED_DOMAINS,
  normalizeDomain,
} from "@brainstack/shared";

export type AddDomainResult =
  | { ok: true; domains: string[] }
  | { ok: false; error: string };

/**
 * Adds one typed or pasted entry to the allow-list, with the same rules the
 * API enforces (`@brainstack/shared`), so the editor can say what is wrong
 * before saving. localhost passes here; in production the API refuses it
 * and its message is shown instead.
 */
export function addDomain(domains: string[], input: string): AddDomainResult {
  const domain = normalizeDomain(input);
  if (!domain) return { ok: false, error: "Type a domain first." };
  if (domains.includes(domain)) {
    return { ok: false, error: `${domain} is already on the list.` };
  }
  const problem = domainProblem(domain, true);
  if (problem) return { ok: false, error: `${domain}: ${problem}` };
  if (domains.length >= MAX_ALLOWED_DOMAINS) {
    return {
      ok: false,
      error: `You can add at most ${MAX_ALLOWED_DOMAINS} domains.`,
    };
  }
  return { ok: true, domains: [...domains, domain] };
}
