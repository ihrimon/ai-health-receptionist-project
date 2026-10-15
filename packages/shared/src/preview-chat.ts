import { z } from 'zod';
import { text } from './text';

/**
 * Dashboard "Test chat" (D-2 §2.5, M3-13). The answer streams back as
 * `ChatStreamEvent`s. The server keeps the conversation: a request carries
 * only the new message and, to continue, the `conversationId` from the
 * last `done` event.
 */

export const PREVIEW_CHAT_LIMITS = {
  messageChars: 2000,
  /** Earlier turns sent with a message. */
  historyTurns: 20,
} as const;

export const previewChatTurnSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  text: text(1, 4000, true),
});

export const previewChatRequestSchema = z.strictObject({
  message: text(1, PREVIEW_CHAT_LIMITS.messageChars, true),
  /** Ignored: the server loads the history of `conversationId` itself. Still accepted so an old open tab doesn't break. */
  history: z
    .array(previewChatTurnSchema)
    .max(PREVIEW_CHAT_LIMITS.historyTurns)
    .default([]),
  /** Continue a stored conversation (the one a reply returned). */
  conversationId: z.uuid().optional(),
  /** Public widget only: the random ID the widget made for this visitor. */
  visitorId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
});

export type PreviewChatTurn = z.output<typeof previewChatTurnSchema>;
export type PreviewChatRequest = z.output<typeof previewChatRequestSchema>;

/** One knowledge chunk the reply was built from (M3-14). */
export interface PreviewChatSource {
  title: string;
  page: number | null;
  similarity: number;
}
