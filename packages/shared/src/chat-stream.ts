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
  /**
   * After a fallback answer, when the company set a way to reach them
   * (D-4 `behavior.handoff`): what to show as a button or link.
   */
  | {
      type: 'handoff';
      kind: 'email' | 'phone' | 'whatsapp' | 'url';
      value: string;
      label: string | null;
    }
  /**
   * The visitor wants to buy, book or be contacted: the widget shows its
   * short contact form below this answer, and submitting it saves a lead
   * (M7-41). Carries nothing: the form's fields are fixed.
   */
  | { type: 'lead_form' }
  /**
   * A second, separate bot message right after an answer that gave contact
   * details: it asks whether the visitor got in touch. Stored in the
   * conversation like any other message.
   */
  | { type: 'follow_up'; text: string }
  /**
   * The visitor has answered that follow-up: the widget may ask for the
   * star rating now instead of waiting for the chat to go quiet.
   */
  | { type: 'rating_prompt' }
  /** The answer is complete. `conversationId` is null when nothing was stored. */
  | {
      type: 'done';
      conversationId: string | null;
      answeredBy: 'llm' | 'custom_answer' | 'fallback';
    }
  /** The stream broke after it started; the partial answer is not stored. */
  | { type: 'error'; message: string };
