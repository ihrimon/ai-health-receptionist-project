import type {
  ChatStreamEvent,
  PreviewChatSource,
  PreviewChatTurn,
} from "@brainstack/shared";
import { postChatStream } from "@/lib/chat-stream";

/** One bubble in the Test chat panel; bot bubbles carry their sources. */
export interface PreviewMessage extends PreviewChatTurn {
  sources?: PreviewChatSource[];
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
