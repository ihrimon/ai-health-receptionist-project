import { type ComponentChildren, Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Markdown } from "../markdown";
import { STRINGS } from "../strings";
import type { Brand } from "../theme";
import type { ChatMessage, LeadFormFields } from "../types";
import { HandoffButton } from "./handoff-button";
import { MinimizeIcon } from "./icons";
import { LeadForm } from "./lead-form";
import { MessageBubble } from "./message-bubble";
import { MessageInput } from "./message-input";
import { TypingIndicator } from "./typing-indicator";

/**
 * The whole chat window, with no state of its own: the page owns the
 * messages and the connection (M4-3). The assistant's texts, the welcome
 * too, are shown as sanitized Markdown (M4-5), and a fallback answer gets
 * its handoff button under it (M4-6). `children` goes under the messages
 * (the quick replies or the rating prompt).
 *
 * Keyboard and screen readers (M4-7): the message box gets focus when the
 * window opens and again when a quick-reply chip it came from disappears;
 * Escape closes the window (when the page can close it). The messages are
 * not a live region, so streamed words are not read out one by one; a
 * hidden live region reads each answer once, when it is complete.
 */
export function ChatWindow({
  title,
  welcomeMessage,
  messages,
  typing,
  busy = false,
  brand,
  onSend,
  onSubmitLead,
  onClose,
  showBranding = true,
  privacyUrl,
  focusSignal = 0,
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
  /** Saves the contact form's details; without it no form is shown (M7-41). */
  onSubmitLead?: (fields: LeadFormFields) => Promise<void>;
  onClose?: () => void;
  showBranding?: boolean;
  /** Where the Privacy Policy is; the notice links to it when given (M7-14). */
  privacyUrl?: string;
  /** Changes when the host page opens the panel: the message box takes focus again (M4-10). */
  focusSignal?: number;
  children?: ComponentChildren;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const announced = useAnswerAnnouncement(messages, typing || busy);

  useEffect(() => {
    // jsdom has no scrollIntoView, hence the optional call.
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [messages, typing]);

  // Opening the chat puts the visitor straight into the message box.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [focusSignal]);

  // A clicked quick-reply chip goes away with the first message; focus
  // would fall to the page body, so it moves back to the message box.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) inputRef.current?.focus({ preventScroll: true });
  }, [messages.length]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div class="flex h-full flex-col bg-white text-zinc-900">
      <header
        class="flex items-center gap-3 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-3 pl-[max(1rem,env(safe-area-inset-left))]"
        style={{ ...brand }}
      >
        <h1 class="flex-1 truncate text-sm font-semibold">{title}</h1>
        {onClose && (
          <button
            type="button"
            aria-label={STRINGS.minimizeChat}
            class="-m-1 rounded-md p-2 opacity-80 hover:opacity-100"
            onClick={onClose}
          >
            <MinimizeIcon />
          </button>
        )}
      </header>

      <div
        role="region"
        aria-label={STRINGS.conversation}
        // Focusable, so a keyboard can scroll back through a long chat.
        tabIndex={0}
        class="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 text-sm"
      >
        <MessageBubble role="assistant" brand={brand}>
          <Markdown text={welcomeMessage} />
        </MessageBubble>
        {messages.map((m) => (
          <Fragment key={m.id}>
            <MessageBubble role={m.role} brand={brand}>
              {m.role === "assistant" ? <Markdown text={m.text} streaming={m.streaming} /> : m.text}
            </MessageBubble>
            {m.handoff && <HandoffButton handoff={m.handoff} brand={brand} />}
            {m.leadForm && onSubmitLead && <LeadForm brand={brand} onSubmit={onSubmitLead} />}
          </Fragment>
        ))}
        {typing && <TypingIndicator />}
        {children}
        <div ref={endRef} />
      </div>

      <div aria-live="polite" aria-atomic="true" class="sr-only" data-testid="announcer">
        {announced && <Markdown key={announced.id} text={announced.text} />}
      </div>

      <p class="px-4 pb-1 text-[11px] leading-snug text-zinc-500" data-testid="privacy-notice">
        {STRINGS.privacyNotice}
        {privacyUrl && (
          <>
            {" "}
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer" class="underline">
              {STRINGS.privacyLink}
            </a>
          </>
        )}
      </p>
      <MessageInput inputRef={inputRef} onSend={onSend} disabled={typing || busy} brand={brand} />
      {showBranding ? (
        <p class="pb-[max(0.5rem,env(safe-area-inset-bottom))] text-center text-[11px] text-zinc-400">
          {STRINGS.poweredBy}
        </p>
      ) : (
        <div class="pb-[env(safe-area-inset-bottom)]" />
      )}
    </div>
  );
}

/**
 * The answer for the live region: the last assistant message, once the
 * reply it belongs to is complete (`pending` goes from true to false),
 * error notes included. History loaded on open is never read out.
 */
function useAnswerAnnouncement(messages: ChatMessage[], pending: boolean): ChatMessage | null {
  const [announced, setAnnounced] = useState<ChatMessage | null>(null);
  const wasPending = useRef(pending);

  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (!finished) return;
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && !last.streaming) setAnnounced(last);
  }, [messages, pending]);

  return announced;
}
