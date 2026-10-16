import type {
  ChatStreamEvent,
  PreviewChatSource,
  PreviewChatTurn,
} from "@brainstack/shared";
import { postChatStream } from "@/lib/chat-stream";

/** One bubble in the Test chat panel; bot bubbles carry their sources. */
export interface PreviewMessage extends PreviewChatTurn {
  sources?: PreviewChatSource[];
  /** "Contact us" shown under a fallback answer. */
  handoff?: Handoff;
}

/** The `handoff` event, without its `type`. */
export interface Handoff {
  kind: "email" | "phone" | "whatsapp" | "url";
  value: string;
  label: string | null;
}

/** Where a handoff button goes: a mail, phone, WhatsApp or web link. */
export function handoffHref({ kind, value }: Handoff): string {
  if (kind === "email") return `mailto:${value}`;
  if (kind === "phone") return `tel:${value.replace(/[^\d+]/g, "")}`;
  if (kind === "whatsapp") return `https://wa.me/${value.replace(/\D/g, "")}`;
  return value;
}

/** The button text: the company's label, or a plain default for the kind. */
export function handoffLabel({ kind, label }: Handoff): string {
  if (label) return label;
  return {
    email: "Email us",
    phone: "Call us",
    whatsapp: "Chat on WhatsApp",
    url: "Contact us",
  }[kind];
}

/** "Returns (p. 2)", or just the title when the chunk has no page. */
export function sourceLabel(source: PreviewChatSource): string {
  return source.page ? `${source.title} (p. ${source.page})` : source.title;
}

/** Sources listed once each, in the order the search ranked them. */
export function uniqueSources(sources: PreviewChatSource[]): string[] {
  return [...new Set(sources.map(sourceLabel))];
}

/**
 * Sends a message and reports the streamed answer as it arrives.
 * `conversationId` continues the stored conversation the last reply
 * ended with; the server keeps the history.
 */
export function sendPreviewMessage(
  message: string,
  conversationId: string | null,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  return postChatStream(
    "/chatbot/preview/messages",
    { message, ...(conversationId ? { conversationId } : {}) },
    onEvent,
  );
}
