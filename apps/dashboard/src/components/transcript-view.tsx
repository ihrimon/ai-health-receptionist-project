import type { ConversationMessage } from "@brainstack/shared";
import { FileText, TriangleAlert } from "lucide-react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { formatDateTime } from "@/lib/api";
import { sourceLabel } from "@/lib/conversations";
import { formatMs, speedTone, timingBreakdown } from "@/lib/response-time";

const ANSWERED_BY: Record<string, string> = {
  custom_answer: "Custom answer",
  fallback: "Fallback: the bot didn't know",
};

/**
 * A conversation's turns as chat bubbles (M5-2). Brought back from the old
 * demo's transcript view, now with the knowledge each answer used and how
 * it was made (custom answer or fallback).
 */
export function TranscriptView({ messages }: { messages: ConversationMessage[] }) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No messages in this conversation.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m) => {
        const isUser = m.role === "user";
        const how = m.answeredBy ? ANSWERED_BY[m.answeredBy] : undefined;
        return (
          <li
            key={m.id}
            className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm break-words ${
                isUser
                  ? "whitespace-pre-wrap bg-primary text-primary-foreground"
                  : "border bg-card text-card-foreground"
              }`}
            >
              {isUser ? m.text : <ChatMarkdown>{m.text}</ChatMarkdown>}
            </div>
            {!isUser && (how || m.sources.length > 0) && (
              <div className="flex max-w-[85%] flex-col gap-1 text-xs text-muted-foreground">
                {how && (
                  <span
                    className={`flex items-center gap-1 ${
                      m.answeredBy === "fallback" ? "text-amber-600 dark:text-amber-500" : ""
                    }`}
                  >
                    {m.answeredBy === "fallback" && <TriangleAlert className="size-3" />}
                    {how}
                  </span>
                )}
                {m.sources.map((s, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <FileText className="size-3 shrink-0" />
                    {sourceLabel(s)}
                  </span>
                ))}
              </div>
            )}
            <time className="text-[11px] text-muted-foreground" dateTime={m.createdAt}>
              {formatDateTime(m.createdAt)}
              {!isUser && m.latencyMs !== null && (
                <span
                  className={
                    speedTone(m.latencyMs) === "very-slow"
                      ? "text-destructive"
                      : speedTone(m.latencyMs) === "slow"
                        ? "text-amber-600 dark:text-amber-500"
                        : ""
                  }
                  title={timingBreakdown(m.timings) || undefined}
                >
                  {" · "}answered in {formatMs(m.latencyMs)}
                </span>
              )}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
