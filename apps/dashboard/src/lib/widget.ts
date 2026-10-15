import type {
  PreviewChatTurn,
  PublicChatConfig,
  PublicChatReply,
} from "@brainstack/shared";
import { apiFetch } from "@/lib/api";

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
  send: (
    publicId: string,
    message: string,
    history: PreviewChatTurn[],
    /** The visitor's random ID and, after the first reply, the stored conversation. */
    visitor: { visitorId: string; conversationId?: string | null },
  ) =>
    apiFetch<PublicChatReply>(
      `/public/chatbots/${encodeURIComponent(publicId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          message,
          history,
          visitorId: visitor.visitorId,
          ...(visitor.conversationId
            ? { conversationId: visitor.conversationId }
            : {}),
        }),
      },
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
