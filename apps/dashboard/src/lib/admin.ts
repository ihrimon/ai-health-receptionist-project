import { apiFetch } from "@/lib/api";

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
