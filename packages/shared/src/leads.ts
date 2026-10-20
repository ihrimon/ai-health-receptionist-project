import { z } from 'zod';
import { conversationRange, isoDateOrDay } from './conversations';

/**
 * Leads (D-2 §2.6, M5-5, FR-8.2): visitors who left their contact details
 * in a chat. The capture_lead tool (M5-4) fills them; the dashboard lists
 * and exports them.
 */

/** Column sizes of the `leads` table (D-1). */
export const LEAD_LIMITS = {
  name: 100,
  email: 255,
  phone: 30,
  /** Answers to the chatbot's "questions to ask" (D-4 allows 5). */
  answers: 10,
  answerChars: 500,
} as const;

/**
 * The answer id under which the contact form's free text ("What do you
 * need?") is stored (M7-41), and the label the dashboard shows for it when
 * the chatbot has no question of that id.
 */
export const LEAD_REQUEST_ANSWER_ID = 'request';
export const LEAD_REQUEST_LABEL = 'What they need';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || undefined)
    .optional();

/**
 * What a captured lead holds (M5-4's tool and the widget form send this).
 * Blank fields are dropped; at least one field or answer is needed.
 */
export const leadInputSchema = z
  .strictObject({
    name: optionalText(LEAD_LIMITS.name),
    email: z
      .string()
      .trim()
      .max(LEAD_LIMITS.email)
      .transform((v) => v.toLowerCase() || undefined)
      .pipe(z.email().optional())
      .optional(),
    phone: z
      .string()
      .trim()
      .max(LEAD_LIMITS.phone)
      .regex(/^[0-9+()\-.\s]*$/, 'Use digits, spaces and + ( ) - . only')
      .transform((v) => v || undefined)
      .optional(),
    /** { [QuestionToAsk.id]: answer } */
    answers: z
      .record(
        z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
        z.string().trim().max(LEAD_LIMITS.answerChars),
      )
      .refine((a) => Object.keys(a).length <= LEAD_LIMITS.answers, {
        message: `At most ${LEAD_LIMITS.answers} answers`,
      })
      .transform((a) =>
        Object.fromEntries(Object.entries(a).filter(([, v]) => v !== '')),
      )
      .optional(),
  })
  .refine(
    (v) =>
      Boolean(v.name || v.email || v.phone) ||
      Object.keys(v.answers ?? {}).length > 0,
    { message: 'A lead needs a name, email, phone or an answer' },
  );

export type LeadInput = z.input<typeof leadInputSchema>;
export type LeadFields = z.output<typeof leadInputSchema>;

const leadFilters = {
  chatbotId: z.uuid().optional(),
  /** Captured on or after this date. */
  from: isoDateOrDay.optional(),
  /** Captured on or before this date (a bare day includes the whole day). */
  to: isoDateOrDay.optional(),
  /** Matches the name, email or phone, ignoring case. */
  q: z.string().trim().max(100).optional(),
};

const fromBeforeTo: [
  (v: { from?: string; to?: string }) => boolean,
  { message: string; path: string[] },
] = [
  (v) => {
    const { from, to } = conversationRange(v);
    return !from || !to || from < to;
  },
  { message: '`from` must be before `to`', path: ['to'] },
];

/** GET /v1/leads query: filters, search and cursor paging. */
export const leadListQuerySchema = z
  .strictObject({
    ...leadFilters,
    /** `nextCursor` from the previous page; opaque to the client. */
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(...fromBeforeTo);

/** GET /v1/leads/export.csv query: the same filters, no paging. */
export const leadExportQuerySchema = z
  .strictObject(leadFilters)
  .refine(...fromBeforeTo);

export type LeadListQuery = z.output<typeof leadListQuerySchema>;
export type LeadExportQuery = z.output<typeof leadExportQuerySchema>;

/** One answer, with the question as the chatbot asks it now. */
export interface LeadAnswer {
  questionId: string;
  /** The question's text, or null if it was removed from the config. */
  question: string | null;
  answer: string;
}

export interface LeadSummary {
  id: string;
  chatbotId: string;
  /** Null once the conversation was deleted (the lead is kept). */
  conversationId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  answers: LeadAnswer[];
  /** The page the chat started on. */
  sourceUrl: string | null;
  createdAt: string;
}

export interface LeadPage {
  items: LeadSummary[];
  nextCursor: string | null;
}
