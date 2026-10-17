import { type AnalyticsDay, type AnalyticsOverview, lastDays } from "@brainstack/shared";
import { apiFetch } from "@/lib/api";

/* ─────────────── Overview analytics (D-2 §2.6, M5-8) ─────────────── */

/** The range choices on the home page, in days (today included). */
export const RANGE_PRESETS = [7, 30, 90] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** What the chart can show, one at a time. */
export type OverviewMetric = "conversations" | "messages" | "leads" | "avgRating";

export const METRIC_LABELS: Record<OverviewMetric, { title: string; unit: string }> = {
  conversations: { title: "Conversations", unit: "conversations" },
  messages: { title: "Messages", unit: "messages" },
  leads: { title: "Leads", unit: "leads" },
  avgRating: { title: "Average rating", unit: "stars" },
};

/** "?from=2026-10-11&to=2026-10-17" for the last `days` UTC days. */
export function overviewQueryString(days: number, now = new Date()): string {
  const { from, to } = lastDays(days, now);
  return `?${new URLSearchParams({ from, to }).toString()}`;
}

/** A day's value for the chart; a day nobody rated has no rating bar. */
export function metricValue(day: AnalyticsDay, metric: OverviewMetric): number | null {
  return day[metric];
}

/**
 * The top of the chart's scale: a round number at or above the largest
 * value (1, 2, 5 × 10ⁿ), so the axis labels stay readable. Ratings always
 * use the full 5-star scale.
 */
export function chartMax(values: (number | null)[], metric: OverviewMetric): number {
  if (metric === "avgRating") return 5;
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  if (max <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= max) return step * power;
  }
  return 10 * power;
}

/** "Oct 17" for a "2026-10-17" day; the day is UTC, so it's read as UTC. */
export function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A number for a stat tile or tooltip ("4.5", "1,234", "—" for none). */
export function formatMetric(value: number | null, metric: OverviewMetric): string {
  if (value === null) return "—";
  return metric === "avgRating" ? value.toFixed(1) : value.toLocaleString("en-US");
}

/** "12%" of fallback answers, or null when the bot answered nothing. */
export function formatRate(rate: number | null): string | null {
  return rate === null ? null : `${Math.round(rate * 100)}%`;
}

export const analyticsApi = {
  overview: (days: number) =>
    apiFetch<AnalyticsOverview>(`/analytics/overview${overviewQueryString(days)}`),
};
