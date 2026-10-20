import type { ChatStreamEvent } from "@brainstack/shared";

/** The company's "contact us" way after a fallback answer (D-4 `behavior.handoff`). */
export type Handoff = Omit<Extract<ChatStreamEvent, { type: "handoff" }>, "type">;

/** One bubble in the chat window. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** The visitor's plain text, or the assistant's Markdown (shown sanitized, M4-5). */
  text: string;
  /** The answer is still streaming in, so its end may be cut mid-mark. */
  streaming?: boolean;
  /** A fallback answer's handoff button (M4-6). */
  handoff?: Handoff;
  /** The answer comes with the contact form below it (M7-41). */
  leadForm?: boolean;
}

/** What the contact form sends (the API's `publicLeadRequestSchema`). */
export interface LeadFormFields {
  name: string;
  email?: string;
  phone?: string;
  message?: string;
}

/**
 * Same limit as the public chat API (`PUBLIC_CHAT_SIZES.messageChars` in
 * @brainstack/shared), copied so zod stays out of the widget bundle.
 */
export const MESSAGE_MAX_CHARS = 1000;
