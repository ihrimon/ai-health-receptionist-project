import { z } from 'zod';

/**
 * Overview analytics (D-2 §2.6, M5-8, FR-8.3). Days are calendar days in
 * ANALYTICS_TIME_ZONE: workspaces have no time zone setting yet, so every
 * day bucket is a UTC day (decisions.md).
 */

export const ANALYTICS_TIME_ZONE = 'UTC';
/** The longest range one request may ask for, in days. */
export const ANALYTICS_MAX_DAYS = 366;
/** The range when the query names none: the last 30 days, today included. */
export const ANALYTICS_DEFAULT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A real calendar day like 2026-10-17 (2026-02-30 is not). */
function isCalendarDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const date = new Date(`${v}T00:00:00Z`);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === v;
}

const calendarDay = z
  .string()
  .trim()
  .refine(isCalendarDay, { message: 'Use a real date like 2026-10-17' });

/** "2026-10-17" of an instant, in UTC. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The day `days` after (or before, if negative) a "YYYY-MM-DD" day. */
export function addDays(day: string, days: number): string {
  return utcDay(new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS));
}

/** Every day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The last `days` days ending today: `{ from, to }` for the overview query. */
export function lastDays(days: number, now = new Date()): { from: string; to: string } {
  const to = utcDay(now);
  return { from: addDays(to, -(days - 1)), to };
}

type RangeQuery = { from?: string; to?: string };

const rangeNotReversed = (v: RangeQuery) => !v.from || !v.to || v.from <= v.to;

function rangeWithinMax(v: RangeQuery): boolean {
  // Zod still runs this when a day is malformed; the field reports that.
  if ((v.from && !isCalendarDay(v.from)) || (v.to && !isCalendarDay(v.to))) {
    return true;
  }
  const { from, to } = analyticsRange(v);
  return (Date.parse(to) - Date.parse(from)) / DAY_MS + 1 <= ANALYTICS_MAX_DAYS;
}

/** GET /v1/analytics/overview query: both days included; defaults to the last 30 days. */
export const analyticsOverviewQuerySchema = z
  .strictObject({
    from: calendarDay.optional(),
    to: calendarDay.optional(),
  })
  .refine(rangeNotReversed, {
    message: '`from` must not be after `to`',
    path: ['to'],
  })
  .refine(rangeWithinMax, {
    message: `Pick at most ${ANALYTICS_MAX_DAYS} days`,
    path: ['from'],
  });

export type AnalyticsOverviewQuery = z.output<typeof analyticsOverviewQuerySchema>;

/**
 * The range a query means: a missing `to` is today (or `from`, if that is
 * later), a missing `from` is 29 days before `to`.
 */
export function analyticsRange(
  query: AnalyticsOverviewQuery,
  now = new Date(),
): { from: string; to: string } {
  const to = query.to ?? (query.from && query.from > utcDay(now) ? query.from : utcDay(now));
  const from = query.from ?? addDays(to, -(ANALYTICS_DEFAULT_DAYS - 1));
  return { from, to };
}

/** One day of the overview; days without activity are zeros. */
export interface AnalyticsDay {
  /** "2026-10-17", a day in `timeZone`. */
  date: string;
  /** Live conversations that started that day (not Test chat, not empty). */
  conversations: number;
  /** Visitor and bot messages sent that day in those conversations. */
  messages: number;
  /** Leads captured that day. */
  leads: number;
  /** Average 1–5 star rating of that day's conversations; null if none were rated. */
  avgRating: number | null;
  /** How many of that day's conversations were rated. */
  ratings: number;
}

/** GET /v1/analytics/overview response. */
export interface AnalyticsOverview {
  from: string;
  to: string;
  /** The time zone the day buckets use ("UTC"). */
  timeZone: string;
  conversations: number;
  messages: number;
  leads: number;
  /** Average over every rated conversation in the range; null if none. */
  avgRating: number | null;
  ratings: number;
  /** Share (0–1) of bot answers that were the fallback; null without answers. */
  fallbackRate: number | null;
  /** One entry per day from `from` to `to`, in order. */
  daily: AnalyticsDay[];
}

/* ─────────────── Top questions (D-2 §2.6, M5-9) ─────────────── */

export const TOP_QUESTIONS_DEFAULT_LIMIT = 10;
export const TOP_QUESTIONS_MAX_LIMIT = 50;
/** Visitor messages scanned per request (the newest in the range); a hard cap. */
export const TOP_QUESTIONS_SCAN_CAP = 5000;
/** Messages shorter than this after cleaning are ignored. */
export const TOP_QUESTIONS_MIN_CHARS = 3;

/** GET /v1/analytics/top-questions query: the overview range plus `limit`. */
export const analyticsTopQuestionsQuerySchema = z
  .strictObject({
    from: calendarDay.optional(),
    to: calendarDay.optional(),
    limit: z.coerce.number().int().min(1).max(TOP_QUESTIONS_MAX_LIMIT).optional(),
  })
  .refine(rangeNotReversed, {
    message: '`from` must not be after `to`',
    path: ['to'],
  })
  .refine(rangeWithinMax, {
    message: `Pick at most ${ANALYTICS_MAX_DAYS} days`,
    path: ['from'],
  });

export type AnalyticsTopQuestionsQuery = z.output<typeof analyticsTopQuestionsQuerySchema>;

/** One group of identical questions (same text after cleaning). */
export interface TopQuestion {
  /** How many times visitors asked it. */
  count: number;
  /** One original wording (the most recent), cut to 200 characters. */
  example: string;
  /** When it was last asked (ISO instant). */
  lastAskedAt: string;
}

/** GET /v1/analytics/top-questions response. */
export interface AnalyticsTopQuestions {
  from: string;
  to: string;
  timeZone: string;
  /** Most asked first; ties go to the most recently asked. */
  questions: TopQuestion[];
  /** True when the range had more visitor messages than the scan cap, so older ones were skipped. */
  truncated: boolean;
}
