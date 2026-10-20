import { apiFetch, type WorkspaceRole } from "@/lib/api";

/* Settings → Workspace (M7-42): the company profile, its people, and the
   signed-in person's own name and password. */

export interface WorkspaceProfile {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  plan: "BETA" | "STARTER" | "GROWTH";
  createdAt: string;
  website: string | null;
  industry: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  timeZone: string;
}

export interface WorkspaceMember {
  name: string;
  email: string;
  role: WorkspaceRole;
  joinedAt: string;
}

/** What the form edits, as plain strings ("" = not set). */
export interface ProfileForm {
  name: string;
  website: string;
  industry: string;
  contactEmail: string;
  contactPhone: string;
  timeZone: string;
}

export function formOf(profile: WorkspaceProfile): ProfileForm {
  return {
    name: profile.name,
    website: profile.website ?? "",
    industry: profile.industry ?? "",
    contactEmail: profile.contactEmail ?? "",
    contactPhone: profile.contactPhone ?? "",
    timeZone: profile.timeZone,
  };
}

/**
 * The PATCH body for what the person actually changed, or null when
 * nothing changed. A detail emptied out is sent as "" (the API clears it).
 */
export function changedFields(
  profile: WorkspaceProfile,
  form: ProfileForm,
): Partial<ProfileForm> | null {
  const before = formOf(profile);
  const body: Partial<ProfileForm> = {};
  for (const key of Object.keys(before) as (keyof ProfileForm)[]) {
    const now = form[key].trim();
    if (now !== before[key]) body[key] = now;
  }
  return Object.keys(body).length > 0 ? body : null;
}

/** Why a new password can't be sent yet, in the person's words; null if fine. */
export function passwordProblem(
  current: string,
  next: string,
  again: string,
  minLength: number,
): string | null {
  if (!current) return "Enter your current password.";
  if (next.length < minLength) {
    return `The new password needs at least ${minLength} characters.`;
  }
  if (next === current) return "Choose a password different from the current one.";
  if (next !== again) return "The two new passwords don't match.";
  return null;
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  VIEWER: "Viewer",
};

export const PLAN_NAMES: Record<WorkspaceProfile["plan"], string> = {
  BETA: "Beta",
  STARTER: "Starter",
  GROWTH: "Growth",
};

/** Time zone names the browser knows (a short list where it can't tell). */
export function timeZoneNames(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  const all = intl.supportedValuesOf?.("timeZone");
  if (all && all.length > 0) return ["UTC", ...all.filter((z) => z !== "UTC")];
  return [
    "UTC",
    "Asia/Dhaka",
    "Asia/Kolkata",
    "Asia/Dubai",
    "Europe/London",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
  ];
}

export const workspaceSettingsApi = {
  profile: () => apiFetch<WorkspaceProfile>("/workspace"),
  update: (body: Partial<ProfileForm>) =>
    apiFetch<WorkspaceProfile>("/workspace", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  members: () => apiFetch<WorkspaceMember[]>("/workspace/members"),
  updateName: (name: string) =>
    apiFetch<void>("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<void>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
};
