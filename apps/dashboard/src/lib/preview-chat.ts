import {
  PREVIEW_CHAT_LIMITS,
  type PreviewChatReply,
  type PreviewChatSource,
  type PreviewChatTurn,
} from "@brainstack/shared";
import { apiFetch } from "@/lib/api";

/** One bubble in the Test chat panel; bot bubbles carry their sources. */
export interface PreviewMessage extends PreviewChatTurn {
  sources?: PreviewChatSource[];
}

/** The earlier turns the API accepts with a message: the most recent ones. */
export function historyFor(messages: PreviewMessage[]): PreviewChatTurn[] {
  return messages
    .slice(-PREVIEW_CHAT_LIMITS.historyTurns)
    .map(({ role, text }) => ({ role, text }));
}

/** "Returns (p. 2)", or just the title when the chunk has no page. */
export function sourceLabel(source: PreviewChatSource): string {
  return source.page ? `${source.title} (p. ${source.page})` : source.title;
}

/** Sources listed once each, in the order the search ranked them. */
export function uniqueSources(sources: PreviewChatSource[]): string[] {
  return [...new Set(sources.map(sourceLabel))];
}

/** `conversationId` continues the stored conversation the last reply returned. */
export function sendPreviewMessage(
  message: string,
  earlier: PreviewMessage[],
  conversationId?: string | null,
): Promise<PreviewChatReply> {
  return apiFetch<PreviewChatReply>("/chatbot/preview/messages", {
    method: "POST",
    body: JSON.stringify({
      message,
      history: historyFor(earlier),
      ...(conversationId ? { conversationId } : {}),
    }),
  });
}
