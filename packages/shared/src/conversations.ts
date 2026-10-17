import { z } from 'zod';
import type { PreviewChatSource } from './preview-chat';

/**
 * Conversation inbox (D-2 §2.6, M5-1). Dates are ISO 8601; a bare day
 * (`2026-10-17`) means that whole UTC day, so `from` is its start and `to`
 * includes all of it.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A bare day (UTC) or an ISO 8601 date-time. */
export const isoDateOrDay = z
  .string()
  .trim()
  .refine(
    (v) =>
      (DAY.test(v) || z.iso.datetime({ offset: true }).safeParse(v).success) &&
      !isNaN(new Date(v).getTime()),
    { message: 'Use a date like 2026-10-17 or an ISO 8601 date-time' },
  );

/** GET /v1/conversations query: filters, text search and cursor paging. */
export const conversationListQuerySchema = z
  .strictObject({
    chatbotId: z.uuid().optional(),
    /** Started on or after this date. */
    from: isoDateOrDay.optional(),
    /** Started on or before this date (a bare day includes the whole day). */
    to: isoDateOrDay.optional(),
    /** Exact star rating, or `none` for conversations without one. */
    rating: z.enum(['1', '2', '3', '4', '5', 'none']).optional(),
    /** `true`: only chats that left a lead; `false`: only those without (M5-5). */
    hasLead: z.enum(['true', 'false']).optional(),
    /** Matches any message's text, ignoring case. */
    q: z.string().trim().max(100).optional(),
    /** `nextCursor` from the previous page; opaque to the client. */
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(
    (v) => {
      const { from, to } = conversationRange(v);
      return !from || !to || from < to;
    },
    { message: '`from` must be before `to`', path: ['to'] },
  );

/**
 * The [from, to) instants of a list query's date filter. A bare `to` day
 * becomes the start of the next day so the whole day is included.
 */
export function conversationRange(query: { from?: string; to?: string }): {
  from?: Date;
  to?: Date;
} {
  const from = query.from ? new Date(query.from) : undefined;
  let to: Date | undefined;
  if (query.to) {
    to = new Date(query.to);
    if (DAY.test(query.to)) to = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  }
  return { from, to };
}

export type ConversationListQuery = z.output<typeof conversationListQuerySchema>;

/** One row of the inbox. */
export interface ConversationSummary {
  id: string;
  chatbotId: string;
  visitorId: string;
  /** The page the chat started on. */
  originUrl: string | null;
  messageCount: number;
  rating: number | null;
  /** The visitor's first message, shortened, for the list. */
  firstMessage: string | null;
  /** At least one answer was the fallback (the bot didn't know). */
  hasFallback: boolean;
  /** The lead this chat left, if any (M5-5). */
  leadId: string | null;
  startedAt: string;
  lastMessageAt: string;
}

export interface ConversationPage {
  items: ConversationSummary[];
  nextCursor: string | null;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Knowledge the answer was built from (assistant messages only). */
  sources: PreviewChatSource[];
  /** "llm" | "custom_answer" | "fallback"; null for the visitor's messages. */
  answeredBy: string | null;
  createdAt: string;
}

/** GET /v1/conversations/:id: the whole transcript, oldest first. */
export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessage[];
}
