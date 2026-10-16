/** One bubble in the chat window. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Plain text for now; the sanitized Markdown view (M4-5) reads the same field. */
  text: string;
}

/**
 * Same limit as the API's chat message (`PREVIEW_CHAT_LIMITS.messageChars`
 * in @brainstack/shared), copied so zod stays out of the widget bundle.
 */
export const MESSAGE_MAX_CHARS = 2000;
