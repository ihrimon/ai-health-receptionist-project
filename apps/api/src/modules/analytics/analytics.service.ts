import {
  type AnalyticsDay,
  type AnalyticsOverview,
  type AnalyticsOverviewQuery,
  type AnalyticsResponseTimes,
  type AnalyticsResponseTimesQuery,
  type AnalyticsTopQuestions,
  type AnalyticsTopQuestionsQuery,
  type AnalyticsUnanswered,
  type AnalyticsUnansweredQuery,
  ANALYTICS_TIME_ZONE,
  analyticsRange,
  daysBetween,
  parseTimings,
  TOP_QUESTIONS_DEFAULT_LIMIT,
  TOP_QUESTIONS_MIN_CHARS,
  TOP_QUESTIONS_SCAN_CAP,
} from '@brainstack/shared';
import { Inject, Injectable } from '@nestjs/common';
import { requireTenant } from '../../tenancy/tenant-context';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';

/** Per-day rows of the three aggregate queries; days without rows are zeros. */
export interface ConversationDayRow {
  day: string;
  conversations: number;
  ratings: number;
  ratingSum: number;
}
export interface MessageDayRow {
  day: string;
  messages: number;
  answers: number;
  fallbacks: number;
}
export interface LeadDayRow {
  day: string;
  leads: number;
}

/**
 * Greetings and thanks that are not questions, compared after cleaning
 * (lowercase, punctuation gone). A small list on purpose; everything else
 * is counted like any other text.
 */
export const NON_QUESTIONS = [
  'hi',
  'hii',
  'hello',
  'hey',
  'hola',
  'yo',
  'ok',
  'okay',
  'thanks',
  'thank you',
  'thx',
  'bye',
  'goodbye',
  'good morning',
  'good afternoon',
  'good evening',
  'hi there',
  'hello there',
  'yes',
  'no',
  'test',
  'হাই',
  'হ্যালো',
  'হেলো',
  'ধন্যবাদ',
  'নমস্কার',
  'আসসালামু আলাইকুম',
  'সালাম',
  'ওকে',
];

/**
 * Regex (Postgres) for the characters that collapse into one space when
 * grouping questions: spaces, punctuation, the Bangla danda and curly
 * quotes. Shared by top questions and unanswered questions.
 */
const CLEAN_PATTERN = '[[:space:][:punct:]।॥“”‘’…]+';

export interface UnansweredRow {
  count: number;
  example: string;
  lastAskedAt: Date;
  conversationId: string;
  scanned: number;
}

export interface ResponseStatsRow {
  count: number;
  avg: number | null;
  p50: number | null;
  p95: number | null;
}
export interface SlowAnswerRow {
  id: string;
  conversationId: string;
  latencyMs: number;
  answeredBy: string | null;
  timings: unknown;
  at: Date;
  question: string | null;
}

export interface TopQuestionRow {
  count: number;
  example: string;
  lastAskedAt: Date;
  scanned: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Builds the overview from the per-day rows: one entry per day of the range
 * (missing days are zeros) plus totals. Averages are weighted by the number
 * of ratings, not averaged per day.
 */
export function buildOverview(
  range: { from: string; to: string },
  rows: {
    conversations: ConversationDayRow[];
    messages: MessageDayRow[];
    leads: LeadDayRow[];
  },
): AnalyticsOverview {
  const conversations = new Map(rows.conversations.map((r) => [r.day, r]));
  const messages = new Map(rows.messages.map((r) => [r.day, r]));
  const leads = new Map(rows.leads.map((r) => [r.day, r]));
  const total = {
    conversations: 0,
    messages: 0,
    leads: 0,
    ratings: 0,
    ratingSum: 0,
    answers: 0,
    fallbacks: 0,
  };

  const daily: AnalyticsDay[] = daysBetween(range.from, range.to).map(
    (date) => {
      const c = conversations.get(date);
      const m = messages.get(date);
      const l = leads.get(date);
      const day: AnalyticsDay = {
        date,
        conversations: c?.conversations ?? 0,
        messages: m?.messages ?? 0,
        leads: l?.leads ?? 0,
        avgRating: c?.ratings ? round2(c.ratingSum / c.ratings) : null,
        ratings: c?.ratings ?? 0,
      };
      total.conversations += day.conversations;
      total.messages += day.messages;
      total.leads += day.leads;
      total.ratings += day.ratings;
      total.ratingSum += c?.ratingSum ?? 0;
      total.answers += m?.answers ?? 0;
      total.fallbacks += m?.fallbacks ?? 0;
      return day;
    },
  );

  return {
    from: range.from,
    to: range.to,
    timeZone: ANALYTICS_TIME_ZONE,
    conversations: total.conversations,
    messages: total.messages,
    leads: total.leads,
    avgRating: total.ratings ? round2(total.ratingSum / total.ratings) : null,
    ratings: total.ratings,
    fallbackRate: total.answers
      ? Math.round((total.fallbacks / total.answers) * 1000) / 1000
      : null,
    daily,
  };
}

/**
 * The dashboard's overview numbers (D-2 §2.6, M5-8). Counts only what the
 * inbox shows: live conversations (not Test chat) the visitor wrote in.
 * Day buckets are calendar days in ANALYTICS_TIME_ZONE (UTC; workspaces
 * have no time zone yet).
 *
 * Raw SQL (Prisma can't group by day), so every query adds its own
 * `workspace_id` condition on every table it reads; the integration suite
 * proves another workspace's rows are never counted.
 */
@Injectable()
export class AnalyticsService {
  /** Replaceable in tests. */
  now: () => Date = () => new Date();

  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  async overview(query: AnalyticsOverviewQuery): Promise<AnalyticsOverview> {
    const { workspaceId } = requireTenant();
    const range = analyticsRange(query, this.now());
    const tz = ANALYTICS_TIME_ZONE;
    // Each query reads [start of `from`, start of the day after `to`) in tz.
    const { from: start, to: end } = range;

    const [conversations, messages, leads] = await Promise.all([
      this.db.$queryRaw<ConversationDayRow[]>`
        SELECT to_char(started_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
               count(*)::int AS conversations,
               count(rating)::int AS ratings,
               coalesce(sum(rating), 0)::int AS "ratingSum"
        FROM conversations
        WHERE workspace_id = ${workspaceId}::uuid
          AND NOT is_preview AND message_count > 0
          AND started_at >= (${start}::date)::timestamp AT TIME ZONE ${tz}
          AND started_at < (${end}::date + 1)::timestamp AT TIME ZONE ${tz}
        GROUP BY 1`,
      this.db.$queryRaw<MessageDayRow[]>`
        SELECT to_char(m.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
               count(*)::int AS messages,
               count(*) FILTER (WHERE m.role = 'ASSISTANT')::int AS answers,
               count(*) FILTER (WHERE m.role = 'ASSISTANT' AND m.answered_by = 'fallback')::int AS fallbacks
        FROM messages m
        JOIN conversations c
          ON c.id = m.conversation_id AND c.workspace_id = ${workspaceId}::uuid
        WHERE m.workspace_id = ${workspaceId}::uuid
          AND NOT c.is_preview AND c.message_count > 0
          AND m.created_at >= (${start}::date)::timestamp AT TIME ZONE ${tz}
          AND m.created_at < (${end}::date + 1)::timestamp AT TIME ZONE ${tz}
        GROUP BY 1`,
      // A lead whose chat was deleted still counts; a Test chat never
      // saves one, but one tied to a preview chat is left out anyway.
      this.db.$queryRaw<LeadDayRow[]>`
        SELECT to_char(l.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
               count(*)::int AS leads
        FROM leads l
        LEFT JOIN conversations c
          ON c.id = l.conversation_id AND c.workspace_id = ${workspaceId}::uuid
        WHERE l.workspace_id = ${workspaceId}::uuid
          AND (c.id IS NULL OR NOT c.is_preview)
          AND l.created_at >= (${start}::date)::timestamp AT TIME ZONE ${tz}
          AND l.created_at < (${end}::date + 1)::timestamp AT TIME ZONE ${tz}
        GROUP BY 1`,
    ]);

    return buildOverview(range, { conversations, messages, leads });
  }

  /**
   * What visitors ask most (M5-9): visitor messages of live, non-empty
   * chats in the range, cleaned (lowercase; spaces, punctuation and the
   * Bangla danda collapsed to single spaces, letters of any script kept)
   * and grouped when identical. No meaning-based clustering yet. Only the
   * newest TOP_QUESTIONS_SCAN_CAP messages of the range are read.
   */
  async topQuestions(
    query: AnalyticsTopQuestionsQuery,
  ): Promise<AnalyticsTopQuestions> {
    const { workspaceId } = requireTenant();
    const range = analyticsRange(query, this.now());
    const tz = ANALYTICS_TIME_ZONE;
    const limit = query.limit ?? TOP_QUESTIONS_DEFAULT_LIMIT;

    const rows = await this.db.$queryRaw<TopQuestionRow[]>`
      WITH scanned AS (
        SELECT m.content, m.created_at
        FROM messages m
        JOIN conversations c
          ON c.id = m.conversation_id AND c.workspace_id = ${workspaceId}::uuid
        WHERE m.workspace_id = ${workspaceId}::uuid
          AND m.role = 'USER'
          AND NOT c.is_preview AND c.message_count > 0
          AND m.created_at >= (${range.from}::date)::timestamp AT TIME ZONE ${tz}
          AND m.created_at < (${range.to}::date + 1)::timestamp AT TIME ZONE ${tz}
        ORDER BY m.created_at DESC
        LIMIT ${TOP_QUESTIONS_SCAN_CAP}
      ),
      cleaned AS (
        SELECT content, created_at,
               btrim(regexp_replace(lower(content),
                 ${CLEAN_PATTERN}, ' ', 'g')) AS norm
        FROM scanned
      )
      SELECT count(*)::int AS count,
             left((array_agg(content ORDER BY created_at DESC))[1], 200) AS example,
             max(created_at) AS "lastAskedAt",
             (SELECT count(*)::int FROM scanned) AS scanned
      FROM cleaned
      WHERE char_length(norm) >= ${TOP_QUESTIONS_MIN_CHARS}
        AND norm <> ALL (${NON_QUESTIONS}::text[])
      GROUP BY norm
      ORDER BY count(*) DESC, max(created_at) DESC
      LIMIT ${limit}`;

    return {
      from: range.from,
      to: range.to,
      timeZone: tz,
      questions: rows.map((r) => ({
        count: r.count,
        example: r.example.trim(),
        lastAskedAt: r.lastAskedAt.toISOString(),
      })),
      // Only known when some rows came back (the scan size rides on them).
      truncated: (rows[0]?.scanned ?? 0) >= TOP_QUESTIONS_SCAN_CAP,
    };
  }

  /**
   * How fast answers were (M7-40): the average, the typical (median) and the
   * slow-end (95th percentile) time of every live answer in the range, and
   * the slowest answers with the question that caused each and where its
   * time went. Test chats are left out, like everywhere else.
   */
  async responseTimes(
    query: AnalyticsResponseTimesQuery,
  ): Promise<AnalyticsResponseTimes> {
    const { workspaceId } = requireTenant();
    const range = analyticsRange(query, this.now());
    const tz = ANALYTICS_TIME_ZONE;
    const limit = query.limit ?? TOP_QUESTIONS_DEFAULT_LIMIT;

    const [stats, slow] = await Promise.all([
      this.db.$queryRaw<ResponseStatsRow[]>`
        SELECT count(*)::int AS count,
               avg(m.latency_ms)::float8 AS avg,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY m.latency_ms))::float8 AS p50,
               (percentile_cont(0.95) WITHIN GROUP (ORDER BY m.latency_ms))::float8 AS p95
        FROM messages m
        JOIN conversations c
          ON c.id = m.conversation_id AND c.workspace_id = ${workspaceId}::uuid
        WHERE m.workspace_id = ${workspaceId}::uuid
          AND m.role = 'ASSISTANT' AND m.latency_ms IS NOT NULL
          AND NOT c.is_preview AND c.message_count > 0
          AND m.created_at >= (${range.from}::date)::timestamp AT TIME ZONE ${tz}
          AND m.created_at < (${range.to}::date + 1)::timestamp AT TIME ZONE ${tz}`,
      this.db.$queryRaw<SlowAnswerRow[]>`
        SELECT m.id::text AS id,
               m.conversation_id::text AS "conversationId",
               m.latency_ms AS "latencyMs",
               m.answered_by AS "answeredBy",
               m.timings AS timings,
               m.created_at AS "at",
               (SELECT left(u.content, 200)
                  FROM messages u
                 WHERE u.conversation_id = m.conversation_id
                   AND u.workspace_id = ${workspaceId}::uuid
                   AND u.role = 'USER'
                   AND u.created_at <= m.created_at
                 ORDER BY u.created_at DESC
                 LIMIT 1) AS question
        FROM messages m
        JOIN conversations c
          ON c.id = m.conversation_id AND c.workspace_id = ${workspaceId}::uuid
        WHERE m.workspace_id = ${workspaceId}::uuid
          AND m.role = 'ASSISTANT' AND m.latency_ms IS NOT NULL
          AND NOT c.is_preview AND c.message_count > 0
          AND m.created_at >= (${range.from}::date)::timestamp AT TIME ZONE ${tz}
          AND m.created_at < (${range.to}::date + 1)::timestamp AT TIME ZONE ${tz}
        ORDER BY m.latency_ms DESC, m.created_at DESC
        LIMIT ${limit}`,
    ]);

    const round = (n: number | null) => (n === null ? null : Math.round(n));
    const row = stats[0];
    return {
      from: range.from,
      to: range.to,
      timeZone: tz,
      count: row?.count ?? 0,
      avgMs: row && row.count > 0 ? round(row.avg) : null,
      p50Ms: row && row.count > 0 ? round(row.p50) : null,
      p95Ms: row && row.count > 0 ? round(row.p95) : null,
      slowest: slow.map((r) => ({
        messageId: r.id,
        conversationId: r.conversationId,
        question: (r.question ?? '').trim(),
        latencyMs: r.latencyMs,
        answeredBy: r.answeredBy,
        timings: parseTimings(r.timings),
        at: r.at.toISOString(),
      })),
    };
  }

  /**
   * Questions the bot could not answer (M5-10): for every fallback reply
   * of a live, non-empty chat in the range, the visitor message right
   * before it, cleaned and grouped like top questions. Each group links
   * to the most recent conversation. Only the newest
   * TOP_QUESTIONS_SCAN_CAP fallback replies of the range are read.
   */
  async unanswered(
    query: AnalyticsUnansweredQuery,
  ): Promise<AnalyticsUnanswered> {
    const { workspaceId } = requireTenant();
    const range = analyticsRange(query, this.now());
    const tz = ANALYTICS_TIME_ZONE;
    const limit = query.limit ?? TOP_QUESTIONS_DEFAULT_LIMIT;

    const rows = await this.db.$queryRaw<UnansweredRow[]>`
      WITH scanned AS (
        SELECT m.conversation_id, m.created_at,
               (SELECT u.content
                  FROM messages u
                 WHERE u.conversation_id = m.conversation_id
                   AND u.workspace_id = ${workspaceId}::uuid
                   AND u.role = 'USER'
                   AND u.created_at <= m.created_at
                 ORDER BY u.created_at DESC
                 LIMIT 1) AS content
        FROM messages m
        JOIN conversations c
          ON c.id = m.conversation_id AND c.workspace_id = ${workspaceId}::uuid
        WHERE m.workspace_id = ${workspaceId}::uuid
          AND m.role = 'ASSISTANT' AND m.answered_by = 'fallback'
          AND NOT c.is_preview AND c.message_count > 0
          AND m.created_at >= (${range.from}::date)::timestamp AT TIME ZONE ${tz}
          AND m.created_at < (${range.to}::date + 1)::timestamp AT TIME ZONE ${tz}
        ORDER BY m.created_at DESC
        LIMIT ${TOP_QUESTIONS_SCAN_CAP}
      ),
      cleaned AS (
        SELECT conversation_id, content, created_at,
               btrim(regexp_replace(lower(content),
                 ${CLEAN_PATTERN}, ' ', 'g')) AS norm
        FROM scanned
        WHERE content IS NOT NULL
      )
      SELECT count(*)::int AS count,
             left((array_agg(content ORDER BY created_at DESC))[1], 200) AS example,
             max(created_at) AS "lastAskedAt",
             (array_agg(conversation_id ORDER BY created_at DESC))[1]::text AS "conversationId",
             (SELECT count(*)::int FROM scanned) AS scanned
      FROM cleaned
      WHERE char_length(norm) >= ${TOP_QUESTIONS_MIN_CHARS}
        AND norm <> ALL (${NON_QUESTIONS}::text[])
      GROUP BY norm
      ORDER BY count(*) DESC, max(created_at) DESC
      LIMIT ${limit}`;

    return {
      from: range.from,
      to: range.to,
      timeZone: tz,
      questions: rows.map((r) => ({
        count: r.count,
        example: r.example.trim(),
        lastAskedAt: r.lastAskedAt.toISOString(),
        conversationId: r.conversationId,
      })),
      truncated: (rows[0]?.scanned ?? 0) >= TOP_QUESTIONS_SCAN_CAP,
    };
  }
}
