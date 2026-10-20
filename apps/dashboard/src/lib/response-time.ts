import type { AnswerTimings } from "@brainstack/shared";

/** "—" for none, "820 ms", "2.4 s" or "1 min 12 s". */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

/** How a time reads to a visitor: fine, slow, or very slow. */
export type SpeedTone = "ok" | "slow" | "very-slow";

export const SLOW_MS = 5000;
export const VERY_SLOW_MS = 10_000;

export function speedTone(ms: number): SpeedTone {
  return ms >= VERY_SLOW_MS ? "very-slow" : ms >= SLOW_MS ? "slow" : "ok";
}

type Part = "embedMs" | "prepareMs" | "llmMs" | "toolMs";

/** What each measured part is, in words a company owner understands. */
export const PART_LABELS: Record<Part, string> = {
  embedMs: "Understanding the question",
  prepareMs: "Searching your knowledge",
  llmMs: "Waiting for the AI model",
  toolMs: "Product and contact lookups",
};

const PARTS: Part[] = ["llmMs", "prepareMs", "embedMs", "toolMs"];

/** The part that took longest, or null when nothing was measured. */
export function mainCause(
  timings: AnswerTimings | null,
): { label: string; ms: number } | null {
  if (!timings) return null;
  const top = PARTS.map((part) => ({ part, ms: timings[part] })).sort(
    (a, b) => b.ms - a.ms,
  )[0];
  return top.ms > 0 ? { label: PART_LABELS[top.part], ms: top.ms } : null;
}

/** "Waiting for the AI model 8.5 s · Searching your knowledge 0.2 s", biggest first. */
export function timingBreakdown(timings: AnswerTimings | null): string {
  if (!timings) return "";
  return PARTS.map((part) => ({ part, ms: timings[part] }))
    .filter((p) => p.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .map((p) => `${PART_LABELS[p.part]} ${formatMs(p.ms)}`)
    .join(" · ");
}
