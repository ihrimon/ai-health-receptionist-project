import type {
  ChatStreamEvent,
  PublicChatConfig,
  PublicConversation,
  PublicMessageView,
} from "@brainstack/shared";
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
  /** Opens a conversation; its token is what every later call needs. */
  startConversation: (
    publicId: string,
    visitorId: string,
    originUrl: string | undefined,
  ) =>
    apiFetch<PublicConversation>(
      `/public/chatbots/${encodeURIComponent(publicId)}/conversations`,
      {
        method: "POST",
        body: JSON.stringify({ visitorId, ...(originUrl ? { originUrl } : {}) }),
      },
    ),
  /** Streams the answer to one message. */
  send: (
    chat: StoredChat,
    message: string,
    onEvent: (event: ChatStreamEvent) => void,
  ) =>
    postChatStream(
      `/public/conversations/${chat.conversationId}/messages`,
      { message },
      onEvent,
      { Authorization: `Bearer ${chat.conversationToken}` },
    ),
  /** The conversation so far, after a reload. */
  history: (chat: StoredChat) =>
    apiFetch<PublicMessageView[]>(
      `/public/conversations/${chat.conversationId}/messages`,
      { headers: { Authorization: `Bearer ${chat.conversationToken}` } },
    ),
};

/** What the chat window remembers between reloads of the page. */
export interface StoredChat {
  visitorId: string;
  conversationId: string;
  conversationToken: string;
}

const storageKey = (publicId: string) => `brainstack:chat:${publicId}`;

/** A random ID for one visitor of the chat window; no personal data. */
export function newVisitorId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

/**
 * The window's own storage (the iframe's origin, so a company's site can't
 * read it), for this browser tab only. Can fail or be empty in a private
 * window, so the chat works without it.
 */
export function loadStoredChat(publicId: string): StoredChat | null {
  try {
    const raw = sessionStorage.getItem(storageKey(publicId));
    if (!raw) return null;
    const chat = JSON.parse(raw) as Partial<StoredChat>;
    return chat.visitorId && chat.conversationId && chat.conversationToken
      ? (chat as StoredChat)
      : null;
  } catch {
    return null;
  }
}

export function saveStoredChat(publicId: string, chat: StoredChat | null) {
  try {
    if (chat) sessionStorage.setItem(storageKey(publicId), JSON.stringify(chat));
    else sessionStorage.removeItem(storageKey(publicId));
  } catch {
    // Not stored: the chat still works until the page is closed.
  }
}

/** Black or white text, whichever reads better on the brand color. */
export function textOn(hex: string): "#000000" | "#ffffff" {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Perceived brightness (ITU-R BT.601).
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#000000" : "#ffffff";
}
