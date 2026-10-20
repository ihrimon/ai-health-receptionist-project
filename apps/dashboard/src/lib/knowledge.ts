import {
  type CreateCustomAnswer,
  type CreateFaq,
  type CreateTextSource,
  DOCUMENT_EXTENSIONS,
  DOCUMENT_MAX_BYTES,
  KNOWLEDGE_LIMITS,
  type UpdateCustomAnswer,
  type UpdateFaq,
  type UpdateTextSource,
} from "@brainstack/shared";
import { apiFetch } from "@/lib/api";

/* ─────────────── API shapes (D-2 §2.3) ─────────────── */

export interface Faq {
  id: string;
  question: string;
  answer: string;
  sortOrder: number;
}

export interface CustomAnswer {
  id: string;
  triggerQuestion: string;
  answer: string;
  isActive: boolean;
}

export type SourceType = "POLICY" | "TEXT" | "DOCUMENT" | "URL";
export type IngestStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";

export interface KnowledgeSource {
  id: string;
  type: SourceType;
  title: string;
  fileName: string | null;
  fileSize: number | null;
  status: IngestStatus;
  /** Why indexing failed, worded for the company. */
  error: string | null;
  updatedAt: string;
}

export interface KnowledgeSourceDetail extends KnowledgeSource {
  content: string | null;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

/** Thin wrappers over the knowledge base API. */
export const knowledgeApi = {
  listFaqs: () => apiFetch<Faq[]>("/faqs"),
  createFaq: (body: CreateFaq) => apiFetch<Faq>("/faqs", json("POST", body)),
  updateFaq: (id: string, body: UpdateFaq) =>
    apiFetch<Faq>(`/faqs/${id}`, json("PATCH", body)),
  deleteFaq: (id: string) => apiFetch<void>(`/faqs/${id}`, json("DELETE")),
  reorderFaqs: (ids: string[]) =>
    apiFetch<Faq[]>("/faqs/order", json("PUT", { ids })),

  listCustomAnswers: () => apiFetch<CustomAnswer[]>("/custom-answers"),
  createCustomAnswer: (body: CreateCustomAnswer) =>
    apiFetch<CustomAnswer>("/custom-answers", json("POST", body)),
  updateCustomAnswer: (id: string, body: UpdateCustomAnswer) =>
    apiFetch<CustomAnswer>(`/custom-answers/${id}`, json("PATCH", body)),
  deleteCustomAnswer: (id: string) =>
    apiFetch<void>(`/custom-answers/${id}`, json("DELETE")),

  listSources: () => apiFetch<KnowledgeSource[]>("/knowledge-sources"),
  getSource: (id: string) =>
    apiFetch<KnowledgeSourceDetail>(`/knowledge-sources/${id}`),
  createSource: (body: CreateTextSource) =>
    apiFetch<KnowledgeSourceDetail>("/knowledge-sources", json("POST", body)),
  updateSource: (id: string, body: UpdateTextSource) =>
    apiFetch<KnowledgeSourceDetail>(
      `/knowledge-sources/${id}`,
      json("PATCH", body),
    ),
  deleteSource: (id: string) =>
    apiFetch<void>(`/knowledge-sources/${id}`, json("DELETE")),
  reindexSource: (id: string) =>
    apiFetch<KnowledgeSource>(
      `/knowledge-sources/${id}/reindex`,
      json("POST"),
    ),
  uploadDocument: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return apiFetch<KnowledgeSource>("/knowledge-sources/upload", {
      method: "POST",
      body: form,
    });
  },
};

/* ─────────────── Plain logic (unit-tested) ─────────────── */

/** Moves the item at `index` one place up or down; unchanged at the ends. */
export function moveItem<T>(items: T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** FAQs whose question or answer contains the query, ignoring case. */
export function filterFaqs(faqs: Faq[], query: string): Faq[] {
  const q = query.trim().toLowerCase();
  if (!q) return faqs;
  return faqs.filter(
    (f) =>
      f.question.toLowerCase().includes(q) ||
      f.answer.toLowerCase().includes(q),
  );
}

/** "12 / 25", and whether another item fits. */
export function limitInfo(count: number, max: number) {
  return { label: `${count} / ${max}`, full: count >= max };
}

/**
 * Checks a file before upload, mirroring the API's rules (M2-10) so the
 * company learns at once; the API still checks the content itself.
 */
export function checkUpload(
  file: { name: string; size: number },
  documentCount: number,
): string | null {
  if (documentCount >= KNOWLEDGE_LIMITS.documents) {
    return `You can upload at most ${KNOWLEDGE_LIMITS.documents} documents. Delete one first.`;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return `"${file.name}" isn't a PDF, Word (.docx), TXT or Markdown file.`;
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    return `"${file.name}" is larger than ${DOCUMENT_MAX_BYTES / 1024 / 1024} MB.`;
  }
  if (file.size === 0) return `"${file.name}" is empty.`;
  return null;
}

export interface StatusBadge {
  label: string;
  tone: "neutral" | "busy" | "ok" | "error";
}

/** How a source's indexing status is shown (D-3 §3.3). */
export function statusBadge(status: IngestStatus): StatusBadge {
  switch (status) {
    case "QUEUED":
      return { label: "Queued", tone: "neutral" };
    case "PROCESSING":
      return { label: "Processing…", tone: "busy" };
    case "READY":
      return { label: "Ready", tone: "ok" };
    case "FAILED":
      return { label: "Failed", tone: "error" };
  }
}

/**
 * Wait before the next status check: 3 s at first, then longer (up to 15 s)
 * while nothing changes, so a slow indexing run does not mean hundreds of
 * identical requests (M7-38).
 */
export function pollDelay(unchangedChecks: number): number {
  return Math.min(3000 * 1.5 ** unchangedChecks, 15_000);
}

/** One word per source state; two equal strings mean nothing changed. */
export function statusSignature(
  sources: { id: string; status: IngestStatus }[],
): string {
  return sources.map((s) => `${s.id}:${s.status}`).join(",");
}

/** Keep polling while any source is still being indexed (D-3: every 3 s at first). */
export function needsPolling(sources: { status: IngestStatus }[]): boolean {
  return sources.some(
    (s) => s.status === "QUEUED" || s.status === "PROCESSING",
  );
}

/** "1.2 MB" for document sizes. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ─────────────── Policy templates (D-3 §3.3) ─────────────── */

export interface PolicyTemplate {
  key: string;
  title: string;
  content: string;
}

/** Starting points for common pages; the company edits the details. */
export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    key: "delivery",
    title: "Delivery policy",
    content: `# Delivery policy

## Where we deliver
We deliver to [areas, e.g. all of Bangladesh].

## Delivery times
- Inside [city]: [1–2] days
- Outside [city]: [3–5] days

## Delivery charges
[e.g. 60 taka inside Dhaka, 120 taka outside. Free over 3,000 taka.]`,
  },
  {
    key: "returns",
    title: "Return policy",
    content: `# Return policy

You can return items within [14] days of delivery if they are unused and in their original packaging.

## How to return
[e.g. Call or WhatsApp us with your order number, and we arrange a pickup.]

## Items that can't be returned
[e.g. Sale items, underwear, personalised products.]`,
  },
  {
    key: "refunds",
    title: "Refund policy",
    content: `# Refund policy

Once we receive a returned item, we refund you within [7] working days.

## How you get your money back
[e.g. To the original payment method; cash on delivery orders by bKash.]`,
  },
  {
    key: "payments",
    title: "Payment methods",
    content: `# Payment methods

We accept:
- [bKash / Nagad]
- [Visa and Mastercard]
- [Cash on delivery, inside Dhaka only]`,
  },
  {
    key: "about",
    title: "About us",
    content: `# About us

[Your business name] has been [what you do] since [year]. [What makes you different, in a sentence or two.]

## Find us
[Address, opening hours, phone.]`,
  },
];
