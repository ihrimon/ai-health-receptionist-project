import { apiFetch, type WorkspaceRole } from "@/lib/api";

/* ─────────────── Platform admin (D-2 §2.8, M7-0) ─────────────── */

export type WorkspacePlan = "BETA" | "STARTER" | "GROWTH";
export type WorkspaceStatus = "ACTIVE" | "SUSPENDED";

export const PLAN_LABELS: Record<WorkspacePlan, string> = {
  BETA: "Beta",
  STARTER: "Starter",
  GROWTH: "Growth",
};

export interface AdminWorkspace {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  plan: WorkspacePlan;
  createdAt: string;
  owner: { id: string; name: string; email: string } | null;
  chatbotCount: number;
  /** A counter of visitor answers this month; message text is never exposed. */
  messagesThisMonth: number;
}

export interface AdminWorkspacePage {
  items: AdminWorkspace[];
  nextCursor: string | null;
}

export interface AdminWorkspaceQuery {
  q?: string;
  status?: WorkspaceStatus;
  cursor?: string;
  limit?: number;
}

/** "?q=acme&status=SUSPENDED" for GET /v1/admin/workspaces; blanks are left out. */
export function adminQueryString(query: AdminWorkspaceQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.status) params.set("status", query.status);
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export const adminApi = {
  listWorkspaces: (query: AdminWorkspaceQuery) =>
    apiFetch<AdminWorkspacePage>(`/admin/workspaces${adminQueryString(query)}`),
  updateWorkspace: (
    id: string,
    body: { status?: WorkspaceStatus; plan?: WorkspacePlan; reason?: string },
  ) =>
    apiFetch<AdminWorkspace>(`/admin/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};

/* ─────────────── Users, support view, delete (M7-35) ─────────────── */

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
  workspaces: { id: string; name: string; role: WorkspaceRole }[];
}

export interface AdminUserPage {
  items: AdminUser[];
  nextCursor: string | null;
}

/** Read-only look at a company's chatbot setup; never conversations or leads. */
export interface SupportView {
  workspace: {
    id: string;
    name: string;
    slug: string;
    status: WorkspaceStatus;
    plan: WorkspacePlan;
    /** What the company wrote about itself in Settings → Workspace (M7-42). */
    website: string | null;
    industry: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    timeZone: string;
  };
  chatbots: {
    id: string;
    publicId: string;
    status: "ENABLED" | "DISABLED";
    allowedDomains: string[];
    installVerifiedHost: string | null;
    draftConfig: unknown;
    publishedVersion: { version: number; publishedAt: string } | null;
  }[];
  faqs: { id: string; question: string; answer: string }[];
  customAnswers: {
    id: string;
    triggerQuestion: string;
    answer: string;
    isActive: boolean;
  }[];
  sources: {
    id: string;
    type: "POLICY" | "TEXT" | "DOCUMENT" | "URL";
    title: string;
    status: "QUEUED" | "PROCESSING" | "READY" | "FAILED";
    error: string | null;
    fileName: string | null;
    fileSize: number | null;
    createdAt: string;
  }[];
}

/** "?q=sam&cursor=..." for GET /v1/admin/users; blanks are left out. */
export function adminUsersQueryString(query: {
  q?: string;
  cursor?: string;
  limit?: number;
}): string {
  return adminQueryString(query);
}

export const adminConsoleApi = {
  listUsers: (query: { q?: string; cursor?: string; limit?: number }) =>
    apiFetch<AdminUserPage>(`/admin/users${adminUsersQueryString(query)}`),
  verifyEmail: (id: string) =>
    apiFetch<AdminUser>(`/admin/users/${id}/verify-email`, { method: "POST" }),
  setPlatformAdmin: (id: string, isPlatformAdmin: boolean, reason?: string) =>
    apiFetch<AdminUser>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isPlatformAdmin, reason }),
    }),
  supportView: (id: string) =>
    apiFetch<SupportView>(`/admin/workspaces/${id}/support-view`),
  deleteWorkspace: (id: string, confirmSlug: string, reason?: string) =>
    apiFetch<{ deleted: true; filesDeleted: number }>(`/admin/workspaces/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmSlug, reason }),
    }),
};

/* ─────────────── Usage and estimated cost (M6-12) ─────────────── */

/** Every money value is an ESTIMATE in USD; real revenue arrives with billing. */
export interface UsageCost {
  conversations: number;
  messages: number;
  previewMessages: number;
  leads: number;
  tokensIn: number;
  tokensOut: number;
  /** Estimated LLM cost of all chat, whoever pays the provider. */
  estimatedCostUsd: number;
  /** The part on a platform key: what the platform pays. */
  platformCostUsd: number;
  /** The part on the company's own key: paid by the company. */
  ownKeyCostUsd: number;
  /** Manual plan price (not real revenue). */
  revenueUsd: number;
  /** revenueUsd - platformCostUsd. */
  profitUsd: number;
}

export interface UsageAssumptions {
  llmPriceInPerMillion: number;
  llmPriceOutPerMillion: number;
  platformKeyShare: number;
  planPriceUsd: Record<WorkspacePlan, number>;
}

export interface UsageRow extends UsageCost {
  workspaceId: string;
  name: string;
  plan: WorkspacePlan;
  status: WorkspaceStatus;
}

export interface UsageOverview {
  period: string;
  assumptions: UsageAssumptions;
  totals: UsageCost;
  workspaceCount: number;
  items: UsageRow[];
}

export interface UsageDetail {
  workspace: { id: string; name: string; plan: WorkspacePlan };
  assumptions: UsageAssumptions;
  months: (UsageCost & { period: string })[];
}

export type UsageSortKey =
  | "name"
  | "conversations"
  | "messages"
  | "leads"
  | "tokens"
  | "estimatedCostUsd"
  | "revenueUsd"
  | "profitUsd";

/** A sorted copy; names A-Z, numbers high to low unless `asc`. Ties keep name order. */
export function sortUsageRows(
  rows: UsageRow[],
  key: UsageSortKey,
  asc: boolean,
): UsageRow[] {
  const value = (r: UsageRow): string | number =>
    key === "name"
      ? r.name.toLowerCase()
      : key === "tokens"
        ? r.tokensIn + r.tokensOut
        : r[key];
  const dir = asc ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x < y) return -dir;
    if (x > y) return dir;
    return a.name.localeCompare(b.name);
  });
}

/** "$0.0123" for small amounts, "$12.34" otherwise; negative amounts keep the sign in front. */
export function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const text = abs > 0 && abs < 1 ? abs.toFixed(4) : abs.toFixed(2);
  return `${n < 0 ? "-" : ""}$${text}`;
}

/** 1234567 -> "1.23M", 4200 -> "4.2K". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export const usageApi = {
  overview: () => apiFetch<UsageOverview>("/admin/usage"),
  workspace: (id: string) => apiFetch<UsageDetail>(`/admin/workspaces/${id}/usage`),
};
