import {
  type AnalyticsDay,
  type AnalyticsOverview,
  type AnalyticsOverviewQuery,
  ANALYTICS_TIME_ZONE,
  analyticsRange,
  daysBetween,
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
}
