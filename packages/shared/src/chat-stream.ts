import type { PreviewChatSource } from './preview-chat';

/**
 * What a chat endpoint streams back (D-2 §3.2): Server-Sent Events, one per
 * item, `event: <type>` and `data: <the rest as JSON>`. The dashboard Test
 * chat and the public widget use the same stream; `sources` is sent to the
 * dashboard only.
 */
export type ChatStreamEvent =
  /** A piece of the answer, in order. */
  | { type: 'delta'; text: string }
  /** The knowledge the answer is built from (dashboard Test chat only). */
  | { type: 'sources'; sources: PreviewChatSource[] }
  /** The answer is complete. `conversationId` is null when nothing was stored. */
  | {
      type: 'done';
      conversationId: string | null;
      answeredBy: 'llm' | 'fallback';
    }
  /** The stream broke after it started; the partial answer is not stored. */
  | { type: 'error'; message: string };
