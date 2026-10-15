import { z } from 'zod';
import { text } from './text';

/**
 * Dashboard "Test chat" (D-2 §2.5, M3-13). The MVP keeps the conversation
 * in the browser, so each request carries the earlier turns; the server
 * only keeps the last few.
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
  history: z
    .array(previewChatTurnSchema)
    .max(PREVIEW_CHAT_LIMITS.historyTurns)
    .default([]),
});

export type PreviewChatTurn = z.output<typeof previewChatTurnSchema>;
export type PreviewChatRequest = z.output<typeof previewChatRequestSchema>;

/** One knowledge chunk the reply was built from (M3-14). */
export interface PreviewChatSource {
  title: string;
  page: number | null;
  similarity: number;
}

export interface PreviewChatReply {
  reply: string;
  sources: PreviewChatSource[];
}
