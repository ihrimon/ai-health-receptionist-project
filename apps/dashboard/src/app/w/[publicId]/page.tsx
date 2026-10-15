"use client";

import type { PublicChatConfig } from "@brainstack/shared";
import { Send, X } from "lucide-react";
import { useParams } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  handoffHref,
  handoffLabel,
  type Handoff,
  type PreviewMessage,
} from "@/lib/preview-chat";
import { cn } from "@/lib/utils";
import {
  newVisitorId,
  textOn,
  WIDGET_MESSAGES,
  widgetApi,
} from "@/lib/widget";

type State =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; config: PublicChatConfig };

/**
 * The chat window visitors see on a company's site (early MVP): opened by
 * public/chatbot.js in an iframe, no login. Always light, so it looks the
 * same on every site. History lives in this page only.
 */
export default function WidgetPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    widgetApi.config(publicId).then(
      (config) => {
        if (cancelled) return;
        setState({ kind: "ready", config });
        // Only colors and side: nothing private goes to the host page.
        window.parent.postMessage(
          {
            type: WIDGET_MESSAGES.config,
            primaryColor: config.primaryColor,
            textColor: textOn(config.primaryColor),
            position: config.position,
          },
          "*",
        );
      },
      () => !cancelled && setState({ kind: "unavailable" }),
    );
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  if (state.kind !== "ready") {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-white p-6 text-center text-sm text-zinc-500">
        {state.kind === "loading"
          ? "Loading…"
          : "This chat isn't available right now."}
      </div>
    );
  }
  return <ChatWindow publicId={publicId} config={state.config} />;
}

function ChatWindow({
  publicId,
  config,
}: {
  publicId: string;
  config: PublicChatConfig;
}) {
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [visitorId] = useState(newVisitorId);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const brand = { background: config.primaryColor, color: textOn(config.primaryColor) };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, sending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    const earlier = messages;
    setMessages([...earlier, { role: "user", text: message }]);
    setInput("");
    setSending(true);
    let started = false;
    let handoff: Handoff | undefined;
    const showAnswer = (text: string) => {
      const replace = started;
      setMessages((current) => {
        const answer: PreviewMessage = { role: "assistant", text, handoff };
        return replace ? [...current.slice(0, -1), answer] : [...current, answer];
      });
    };
    try {
      let text = "";
      await widgetApi.send(
        publicId,
        message,
        { visitorId, conversationId },
        (event) => {
          if (event.type === "delta") {
            text += event.text;
            showAnswer(text);
            started = true;
          } else if (event.type === "handoff") {
            handoff = event;
            showAnswer(text);
          } else if (event.type === "done") {
            setConversationId(event.conversationId);
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        },
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      // A broken answer is not stored, so none of it stays on screen.
      setMessages((current) => [
        ...(started ? current.slice(0, -1) : current),
        {
          role: "assistant",
          text:
            status === 429
              ? "You're sending messages quickly. Please wait a minute and try again."
              : "Sorry, something went wrong. Please try again.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="flex h-full flex-col bg-white text-zinc-900">
      <header className="flex items-center gap-3 px-4 py-3" style={brand}>
        {config.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
        )}
        <h1 className="flex-1 truncate text-sm font-semibold">{config.headerTitle}</h1>
        <button
          type="button"
          aria-label="Close chat"
          className="rounded-md p-1 opacity-80 hover:opacity-100"
          onClick={() => window.parent.postMessage({ type: WIDGET_MESSAGES.close }, "*")}
        >
          <X className="size-5" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
        <Bubble mine={false}>{config.welcomeMessage}</Bubble>
        {messages.length === 0 && config.quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {config.quickReplies.map((q) => (
              <button
                key={q}
                type="button"
                className="rounded-full border px-3 py-1 text-xs hover:bg-zinc-50"
                style={{ borderColor: config.primaryColor, color: config.primaryColor }}
                onClick={() => void send(q)}
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="space-y-1">
            <Bubble mine={m.role === "user"} brand={brand}>
              {m.text}
            </Bubble>
            {m.handoff && (
              <a
                href={handoffHref(m.handoff)}
                target="_blank"
                rel="noreferrer"
                className="ml-1 inline-block rounded-full border px-3 py-1 text-xs hover:bg-zinc-50"
                style={{
                  borderColor: config.primaryColor,
                  color: config.primaryColor,
                }}
              >
                {handoffLabel(m.handoff)}
              </a>
            )}
          </div>
        ))}
        {sending && messages.at(-1)?.role === "user" && (
          <Bubble mine={false}>
            <span className="text-zinc-500">Typing…</span>
          </Bubble>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t p-3">
        <textarea
          value={input}
          rows={1}
          maxLength={2000}
          aria-label="Your message"
          placeholder="Type a message…"
          className="max-h-28 min-h-9 flex-1 resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={sending || !input.trim()}
          className="flex size-9 items-center justify-center rounded-lg disabled:opacity-50"
          style={brand}
        >
          <Send className="size-4" />
        </button>
      </form>
      {config.showBranding && (
        <p className="pb-2 text-center text-[11px] text-zinc-400">
          Powered by BrainStack
        </p>
      )}
    </div>
  );
}

function Bubble({
  mine,
  brand,
  children,
}: {
  mine: boolean;
  brand?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-fit max-w-[85%] rounded-2xl px-3 py-2 whitespace-pre-wrap",
        mine ? "ml-auto" : "bg-zinc-100",
      )}
      style={mine ? brand : undefined}
    >
      {children}
    </div>
  );
}
