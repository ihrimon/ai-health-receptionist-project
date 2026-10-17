import type {
  ConversationDetail,
  ConversationPage,
  PreviewChatSource,
} from "@brainstack/shared";
import { apiFetch } from "@/lib/api";

/* ─────────────── Conversation inbox (D-2 §2.6, M5-1, M5-2) ─────────────── */

export type RatingFilter = "1" | "2" | "3" | "4" | "5" | "none";

export interface ConversationQuery {
  q?: string;
  /** A day, "2026-10-17" (from an <input type="date">). */
  from?: string;
  to?: string;
  rating?: RatingFilter;
  /** Only chats that did ("true") or didn't ("false") leave a lead (M5-5). */
  hasLead?: "true" | "false";
  chatbotId?: string;
  cursor?: string;
  limit?: number;
}

/** "?q=refund&rating=4" for GET /v1/conversations; blanks are left out. */
export function conversationQueryString(query: ConversationQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.rating) params.set("rating", query.rating);
  if (query.hasLead) params.set("hasLead", query.hasLead);
  if (query.chatbotId) params.set("chatbotId", query.chatbotId);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** A short, stable name for an anonymous visitor: "Visitor #a91f". */
export function visitorLabel(visitorId: string): string {
  const tail = visitorId.replace(/[^a-z0-9]/gi, "").slice(-4).toLowerCase();
  return `Visitor #${tail || "????"}`;
}

/** "acme.com/products/wallet" from the page the chat started on. */
export function originLabel(originUrl: string | null): string | null {
  if (!originUrl) return null;
  try {
    const url = new URL(originUrl);
    const path = url.pathname === "/" ? "" : url.pathname;
    return `${url.host.replace(/^www\./, "")}${path}`;
  } catch {
    return originUrl;
  }
}

/** Only http(s) links are made clickable. */
export function isSafeLink(url: string | null): url is string {
  if (!url) return false;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** "Returns policy · p. 2 (0.82)". */
export function sourceLabel(source: PreviewChatSource): string {
  const page = source.page ? ` · p. ${source.page}` : "";
  return `${source.title}${page} (${source.similarity.toFixed(2)})`;
}

/** "2m ago", "3h ago", "4d ago", then the date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { dateStyle: "medium" });
}

export const conversationsApi = {
  list: (query: ConversationQuery) =>
    apiFetch<ConversationPage>(`/conversations${conversationQueryString(query)}`),
  get: (id: string) =>
    apiFetch<ConversationDetail>(`/conversations/${encodeURIComponent(id)}`),
  /** Privacy (M5-3): the conversation and all its messages; owner or admin only. */
  remove: (id: string) =>
    apiFetch<void>(`/conversations/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
