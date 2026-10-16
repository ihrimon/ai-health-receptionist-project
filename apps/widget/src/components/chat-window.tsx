import { type ComponentChildren, Fragment } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Markdown } from "../markdown";
import { STRINGS } from "../strings";
import type { Brand } from "../theme";
import type { ChatMessage } from "../types";
import { HandoffButton } from "./handoff-button";
import { CloseIcon } from "./icons";
import { MessageBubble } from "./message-bubble";
import { MessageInput } from "./message-input";
import { TypingIndicator } from "./typing-indicator";

/**
 * The whole chat window, with no state of its own: the page owns the
 * messages and the connection (M4-3). The assistant's texts, the welcome
 * too, are shown as sanitized Markdown (M4-5), and a fallback answer gets
 * its handoff button under it (M4-6). `children` goes under the messages
 * (the quick replies or the rating prompt).
 */
export function ChatWindow({
  title,
  welcomeMessage,
  messages,
  typing,
  busy = false,
  brand,
  onSend,
  onClose,
  showBranding = true,
  children,
}: {
  title: string;
  welcomeMessage: string;
  messages: ChatMessage[];
  /** True while waiting for the answer's first word; sending waits too. */
  typing: boolean;
  /** True until the answer is complete (it may be streaming already). */
  busy?: boolean;
  brand: Brand;
  onSend: (text: string) => void;
  onClose?: () => void;
  showBranding?: boolean;
  children?: ComponentChildren;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // jsdom has no scrollIntoView, hence the optional call.
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, typing]);

  return (
    <div class="flex h-full flex-col bg-white text-zinc-900">
      <header class="flex items-center gap-3 px-4 py-3" style={{ ...brand }}>
        <h1 class="flex-1 truncate text-sm font-semibold">{title}</h1>
        {onClose && (
          <button
            type="button"
            aria-label={STRINGS.closeChat}
            class="rounded-md p-1 opacity-80 hover:opacity-100"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        )}
      </header>

      <div class="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
        <MessageBubble role="assistant" brand={brand}>
          <Markdown text={welcomeMessage} />
        </MessageBubble>
        {messages.map((m) => (
          <Fragment key={m.id}>
            <MessageBubble role={m.role} brand={brand}>
              {m.role === "assistant" ? <Markdown text={m.text} streaming={m.streaming} /> : m.text}
            </MessageBubble>
            {m.handoff && <HandoffButton handoff={m.handoff} brand={brand} />}
          </Fragment>
        ))}
        {typing && <TypingIndicator />}
        {children}
        <div ref={endRef} />
      </div>

      <MessageInput onSend={onSend} disabled={typing || busy} brand={brand} />
      {showBranding && (
        <p class="pb-2 text-center text-[11px] text-zinc-400">{STRINGS.poweredBy}</p>
      )}
    </div>
  );
}
