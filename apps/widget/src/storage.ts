import type { Conversation } from "./api";

/**
 * What the widget remembers in the iframe's own localStorage (our origin,
 * so the company's site can't read it): a random visitor ID and the open
 * conversation with its token, per chatbot. Storage can be missing, full
 * or blocked (private windows, third-party storage rules), so every read
 * and write is guarded and the chat works without it, only forgetting
 * the conversation on reload.
 */
export interface Stored {
  visitorId?: string;
  conversation?: Conversation;
}

const key = (publicId: string) => `brainstack:chat:${publicId}`;
const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function loadStored(publicId: string): Stored {
  try {
    const raw = localStorage.getItem(key(publicId));
    if (!raw) return {};
    const data = JSON.parse(raw) as { visitorId?: unknown; conversation?: Partial<Conversation> };
    const stored: Stored = {};
    if (isText(data.visitorId)) stored.visitorId = data.visitorId;
    const c = data.conversation;
    if (c && isText(c.conversationId) && isText(c.conversationToken)) {
      stored.conversation = {
        conversationId: c.conversationId,
        conversationToken: c.conversationToken,
      };
    }
    return stored;
  } catch {
    return {};
  }
}

export function saveStored(publicId: string, stored: Stored): void {
  try {
    localStorage.setItem(key(publicId), JSON.stringify(stored));
  } catch {
    // Not saved: the chat goes on and is forgotten on reload.
  }
}

/** A random visitor ID (32 hex characters, no personal data). */
export function newVisitorId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
