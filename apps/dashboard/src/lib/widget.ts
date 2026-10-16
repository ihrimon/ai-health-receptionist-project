import {
  type ChatStreamEvent,
  type HostToWidgetMessage,
  type PublicChatConfig,
  type PublicConversation,
  type PublicMessageView,
  WIDGET_PROTOCOL_NS,
  WIDGET_PROTOCOL_VERSION,
  type WidgetToHostMessage,
} from "@brainstack/shared";
import { apiFetch } from "@/lib/api";
import { postChatStream } from "@/lib/chat-stream";

/* The embeddable widget (early MVP): the /w/[publicId] page that
   public/chatbot.js opens in an iframe on the company's site. */

/** The page's line to the loader on the host page (protocol v1, M4-10). */
export interface LoaderLink {
  /** Held back until the loader has said who it is (`init`). */
  post(message: WidgetToHostMessage): void;
  disconnect(): void;
}

/** The part of `window` the link uses, so tests can pass a fake. */
export type LoaderWindow = Pick<Window, "parent" | "addEventListener" | "removeEventListener"> & {
  location: { ancestorOrigins?: { length: number; [index: number]: string } };
};

/**
 * Connects to the loader (`chatbot.js`, built from apps/widget), or null
 * outside a frame. Same rules as the widget app's `connectHost`
 * (apps/widget/src/host.ts), kept here because this page is only the
 * fallback until M4-19 serves the widget app: an empty `ready` to `*`,
 * then only the parent's `init` sets the host origin, and every later
 * message goes to and comes only from that origin.
 */
export function connectLoader(win: LoaderWindow): LoaderLink | null {
  if (!win.parent || win.parent === (win as unknown)) return null;
  let hostOrigin: string | null = null;
  const queue: WidgetToHostMessage[] = [];
  const wrap = (message: WidgetToHostMessage) => ({
    ns: WIDGET_PROTOCOL_NS,
    v: WIDGET_PROTOCOL_VERSION,
    ...message,
  });
  const send = (message: WidgetToHostMessage) =>
    win.parent.postMessage(wrap(message), hostOrigin!);

  const listener = (event: MessageEvent) => {
    if (hostOrigin !== null || event.source !== win.parent) return;
    if (!isInit(event.data) || !/^https?:\/\//.test(event.origin)) return;
    const ancestors = win.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0 && ancestors[0] !== event.origin) return;
    hostOrigin = event.origin;
    queue.splice(0).forEach(send);
  };

  win.addEventListener("message", listener);
  win.parent.postMessage(wrap({ type: "ready" }), "*");
  return {
    post: (message) => (hostOrigin ? send(message) : queue.push(message)),
    disconnect: () => win.removeEventListener("message", listener),
  };
}

function isInit(data: unknown): data is HostToWidgetMessage {
  const m = data as Partial<HostToWidgetMessage & { ns: string; v: number }> | null;
  return (
    !!m &&
    m.ns === WIDGET_PROTOCOL_NS &&
    m.v === WIDGET_PROTOCOL_VERSION &&
    m.type === "init" &&
    typeof m.open === "boolean"
  );
}

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
