import type { LeadPage, LeadSummary } from "@brainstack/shared";
import { API_BASE, API_HEADERS, ApiError, apiFetch } from "@/lib/api";

/* ─────────────── Leads (D-2 §2.6, M5-5, FR-8.2) ─────────────── */

export interface LeadQuery {
  q?: string;
  /** A day, "2026-10-17" (from an <input type="date">). */
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/** "?q=ana&from=2026-10-01" for GET /v1/leads; blanks are left out. */
export function leadQueryString(query: LeadQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The lead's best name for the list: name, else email, else phone. */
export function leadTitle(lead: Pick<LeadSummary, "name" | "email" | "phone">): string {
  return lead.name ?? lead.email ?? lead.phone ?? "Unnamed lead";
}

/** The file name from `Content-Disposition`, or a dated default. */
export function attachmentName(header: string | null, now = new Date()): string {
  const match = header && /filename="([^"]+)"/.exec(header);
  return match ? match[1] : `leads-${now.toISOString().slice(0, 10)}.csv`;
}

export const leadsApi = {
  list: (query: LeadQuery) => apiFetch<LeadPage>(`/leads${leadQueryString(query)}`),
  /** Owner or admin only. */
  remove: (id: string) =>
    apiFetch<void>(`/leads/${encodeURIComponent(id)}`, { method: "DELETE" }),
  /**
   * Downloads every lead matching the filters as CSV (owner or admin).
   * Fetched with the session cookie, then saved through a temporary link.
   */
  async exportCsv(query: Omit<LeadQuery, "cursor" | "limit">): Promise<void> {
    const res = await fetch(`${API_BASE}/leads/export.csv${leadQueryString(query)}`, {
      credentials: "include",
      headers: API_HEADERS,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(body?.message ?? `API returned ${res.status}`, res.status);
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = attachmentName(res.headers.get("Content-Disposition"));
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
