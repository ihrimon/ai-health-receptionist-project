import type { ChatStreamEvent, PublicChatConfig } from "@brainstack/shared";
import { apiFetch } from "@/lib/api";
import { postChatStream } from "@/lib/chat-stream";

/* The embeddable widget (early MVP): the /w/[publicId] page that
   public/chatbot.js opens in an iframe on the company's site. */

/** Messages between the widget page and the loader on the host page. */
export const WIDGET_MESSAGES = {
  /** Page → loader: colors and side for the launcher button. */
  config: "brainstack:config",
  /** Page → loader: the visitor closed the chat. */
  close: "brainstack:close",
} as const;

export const widgetApi = {
  config: (publicId: string) =>
    apiFetch<PublicChatConfig>(
      `/public/chatbots/${encodeURIComponent(publicId)}/config`,
    ),
  /** Streams the answer; `visitor` is the widget's random ID and, after the first answer, the stored conversation. */
  send: (
    publicId: string,
    message: string,
    visitor: { visitorId: string; conversationId?: string | null },
    onEvent: (event: ChatStreamEvent) => void,
  ) =>
    postChatStream(
      `/public/chatbots/${encodeURIComponent(publicId)}/messages`,
      {
        message,
        visitorId: visitor.visitorId,
        ...(visitor.conversationId
          ? { conversationId: visitor.conversationId }
          : {}),
      },
      onEvent,
    ),
};

/** A random ID for one visitor of the chat window; no personal data. */
export function newVisitorId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/** Black or white text, whichever reads better on the brand color. */
export function textOn(hex: string): "#000000" | "#ffffff" {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Perceived brightness (ITU-R BT.601).
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#000000" : "#ffffff";
}
