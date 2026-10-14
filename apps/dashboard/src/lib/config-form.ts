import {
  type ChatbotConfig,
  chatbotConfigSchema,
  type PublishProblem,
} from "@brainstack/shared";

/**
 * Plain logic behind the chatbot editor (M2-18) and the publish banner
 * (M2-20), kept free of React so it can be unit-tested.
 */

/** Messages per field, keyed by the config path ("identity.botName"). */
export type FieldErrors = Record<string, string>;

export type DraftCheck =
  | { ok: true; config: ChatbotConfig }
  | { ok: false; errors: FieldErrors };

/**
 * Checks the editor's draft with the same schema the API uses
 * (@brainstack/shared), so mistakes show next to their field before
 * saving. The parsed config is trimmed, with blank optional fields as null.
 */
export function checkDraft(draft: ChatbotConfig): DraftCheck {
  const result = chatbotConfigSchema.safeParse(draft);
  if (result.success) return { ok: true, config: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    // The first message per field is the one to fix first.
    errors[path] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Deep equality for JSON values, ignoring object key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const keys = Object.keys(aObj);
  return (
    keys.length === Object.keys(bObj).length &&
    keys.every((k) => Object.hasOwn(bObj, k) && sameJson(aObj[k], bObj[k]))
  );
}

/**
 * Whether the editor holds edits not yet saved. Compared after parsing, so
 * clearing a field to "" (stored as null) or adding spaces isn't a change.
 */
export function hasUnsavedEdits(
  saved: ChatbotConfig,
  draft: ChatbotConfig,
): boolean {
  const check = checkDraft(draft);
  return !check.ok || !sameJson(check.config, saved);
}

export interface ChipResult {
  list: string[];
  error?: string;
}

/** Adds a topic or quick reply, refusing blanks, repeats and overflow. */
export function addChip(
  list: string[],
  value: string,
  max: number,
  maxLength: number,
): ChipResult {
  const text = value.trim();
  if (!text) return { list };
  if (text.length > maxLength) {
    return { list, error: `At most ${maxLength} characters` };
  }
  if (list.some((item) => item.toLowerCase() === text.toLowerCase())) {
    return { list, error: "Already in the list" };
  }
  if (list.length >= max) return { list, error: `At most ${max} items` };
  return { list: [...list, text] };
}

/** What GET /v1/chatbot reports about publishing (D-2 §2.2). */
export interface PublishInfo {
  publishedVersion: { version: number; publishedAt: string } | null;
  hasUnpublishedChanges: boolean;
  publishProblems: PublishProblem[];
}

export type BannerState =
  | { show: false }
  | {
      show: true;
      label: string;
      canPublish: boolean;
      /** Why Publish is disabled; empty when it isn't. */
      reasons: string[];
    };

/**
 * The header banner (D-3 §2): shown on every dashboard page while the
 * draft differs from what's live, with the reasons publishing would fail.
 */
export function bannerState(info: PublishInfo): BannerState {
  if (!info.hasUnpublishedChanges) return { show: false };
  const reasons = info.publishProblems.map((p) => p.message);
  return {
    show: true,
    label: info.publishedVersion ? "Unpublished changes" : "Not published yet",
    canPublish: reasons.length === 0,
    reasons,
  };
}

export type EditorTab = "general" | "behavior" | "appearance";

/** The editor tab that holds a config field, to jump to its error. */
export function tabForField(path: string): EditorTab {
  if (path.startsWith("behavior.")) return "behavior";
  if (path.startsWith("widget.")) return "appearance";
  return "general";
}
