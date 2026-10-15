export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Every API route except /health lives under /v1 (D-2 §1). */
export const API_BASE = `${API_URL}/v1`;

/**
 * The API rejects state-changing requests without X-Requested-With: fetch
 * (its CSRF check, D-2 §1), so send it on every call.
 */
export const API_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "fetch",
};

/**
 * The real bs_session cookie belongs to the API's own domain (set by
 * its Set-Cookie response) — the browser only ever attaches it to
 * requests TO the API, never to requests to the dashboard's own domain.
 * That's invisible locally (dashboard and API are both "localhost", just
 * different ports, so the host-only cookie reaches both), but once
 * deployed to separate domains (e.g. a vercel.app dashboard + an
 * onrender.com API) the dashboard's own server-side middleware
 * (src/proxy.ts) can never see it to gate /admin/* routes.
 *
 * This is a same-domain, non-httpOnly marker cookie the dashboard sets on
 * itself right after a successful login, purely so that middleware has
 * something local to check for the redirect-to-login UX. It carries no
 * session data — the real security boundary is the API's session guard,
 * not this cookie.
 */
const DASH_SESSION_COOKIE = "dash_session";
const DASH_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // matches the API's SESSION_TTL_MS

export function markDashboardSession() {
  document.cookie = `${DASH_SESSION_COOKIE}=1; path=/; max-age=${DASH_SESSION_MAX_AGE_SECONDS}; samesite=lax`;
}

export function clearDashboardSession() {
  document.cookie = `${DASH_SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** An API error, with the HTTP status so callers can react to 401/403. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Thin JSON fetch wrapper — throws ApiError with the API's own message when present. */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    ...API_HEADERS,
    ...(init?.headers as Record<string, string> | undefined),
  };
  // A file upload: the browser sets the multipart Content-Type (with its
  // boundary) itself.
  if (init?.body instanceof FormData) delete headers["Content-Type"];

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      (Array.isArray(body?.message) ? body.message.join(", ") : body?.message) ??
      `API returned ${res.status}`;
    throw new ApiError(message, res.status);
  }

  // Some endpoints (e.g. DELETE) send a 200 with an empty body rather than
  // a 204 — parse defensively on the body's actual content, not the status
  // code, so those don't throw "Unexpected end of JSON input".
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export type WorkspaceRole = "OWNER" | "ADMIN" | "VIEWER";

/** GET /v1/auth/me (D-2 §2.1). */
export interface Me {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerifiedAt: string | null;
    isPlatformAdmin: boolean;
  };
  activeWorkspace: {
    id: string;
    name: string;
    slug: string;
    status: string;
  } | null;
  role: WorkspaceRole | null;
  memberships: {
    workspace: { id: string; name: string; slug: string };
    role: WorkspaceRole;
  }[];
}

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface Conversation {
  id: string;
  callSid: string;
  transcript?: ChatTurn[];
  summary?: string;
  duration?: number;
  rating?: number;
  createdAt: string;
}

export type LlmProvider =
  | "groq"
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "unorouter";

export interface LlmCredential {
  id: string;
  provider: LlmProvider;
  apiKey: string;
  model: string;
  sortOrder: number;
  isActive: boolean;
  lastUsedAt?: string;
  rlLimitRequests?: number;
  rlRemainingRequests?: number;
  rlResetRequests?: string;
  rlLimitTokens?: number;
  rlRemainingTokens?: number;
  rlResetTokens?: string;
  createdAt: string;
  updatedAt: string;
}

export function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
