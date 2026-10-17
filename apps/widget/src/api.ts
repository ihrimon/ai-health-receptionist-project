import type {
  ChatStreamEvent,
  PublicChatConfig,
  PublicConversation,
  PublicMessageView,
} from "@brainstack/shared";
import { API_BASE } from "./env";

/* The public chat API (D-2 §3). No cookies: the widget has no login, and
   the API opens CORS to the widget's origin for these routes only. A
   conversation is reached with its signed token (`Authorization: Bearer`). */

/** An HTTP error, or status 0 when the request never reached the API. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** What the visitor needs to come back to their conversation. */
export interface Conversation {
  conversationId: string;
  conversationToken: string;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, credentials: "omit" });
  } catch {
    throw new ApiError("The chat could not be reached", 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
    const message = typeof body?.message === "string" ? body.message : `API returned ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return res;
}

/** A POST: JSON, plus the header the API's CSRF check wants. */
function post(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "fetch",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

const bearer = (chat: Conversation) => ({ Authorization: `Bearer ${chat.conversationToken}` });

const botPath = (publicId: string) => `/public/chatbots/${encodeURIComponent(publicId)}`;
const conversationPath = (chat: Conversation, what: "messages" | "rating" = "messages") =>
  `/public/conversations/${encodeURIComponent(chat.conversationId)}/${what}`;

export const widgetApi = {
  /** The published look and texts. A 404 means the chat is off or unknown. */
  async config(publicId: string): Promise<PublicChatConfig> {
    // A plain GET with no custom headers, so the browser needs no preflight.
    return (await call(`${botPath(publicId)}/config`)).json() as Promise<PublicChatConfig>;
  },

  async startConversation(
    publicId: string,
    visitorId: string,
    originUrl?: string,
  ): Promise<PublicConversation> {
    const res = await call(
      `${botPath(publicId)}/conversations`,
      post({ visitorId, ...(originUrl ? { originUrl } : {}) }),
    );
    return res.json() as Promise<PublicConversation>;
  },

  /** The visitor's 1–5 stars for this conversation (FR-4.6, M5-7). */
  async rate(chat: Conversation, rating: number): Promise<void> {
    await call(conversationPath(chat, "rating"), post({ rating }, bearer(chat)));
  },

  /** The conversation so far, for a reloaded page. */
  async history(chat: Conversation): Promise<PublicMessageView[]> {
    const res = await call(conversationPath(chat), { headers: bearer(chat) });
    return res.json() as Promise<PublicMessageView[]>;
  },

  /**
   * Sends one message and calls `onEvent` for each streamed event as it
   * arrives (D-2 §3.2). Resolves when the stream ends; an HTTP error
   * before it starts (401, 404, 429) throws ApiError.
   */
  async send(
    chat: Conversation,
    message: string,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void> {
    const res = await call(conversationPath(chat), post({ message }, bearer(chat)));
    if (!res.body) throw new ApiError("The chat gave no answer", res.status);
    await readSse(res.body, onEvent);
  },
};

/** Reads a Server-Sent Events body to the end, event by event. */
export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    // The last event may end without its blank line when the stream closes.
    const parsed = parseSseEvents(done ? `${buffer}\n\n` : buffer);
    buffer = parsed.rest;
    parsed.events.forEach(onEvent);
    if (done) return;
  }
}

/**
 * Splits the text read so far into whole events and what is left over (an
 * event cut in the middle). Events are separated by a blank line; each
 * has `event:` and `data:` lines. Same parser as the dashboard's Test chat.
 */
export function parseSseEvents(buffer: string): {
  events: ChatStreamEvent[];
  rest: string;
} {
  const events: ChatStreamEvent[] = [];
  const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let type = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!type) continue;
    try {
      const payload = data ? (JSON.parse(data) as object) : {};
      events.push({ type, ...payload } as ChatStreamEvent);
    } catch {
      // A broken event is skipped; the stream goes on.
    }
  }
  return { events, rest };
}
