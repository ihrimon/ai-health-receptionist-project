"use client";

import type { PreviewChatSource } from "@brainstack/shared";
import { Info, RotateCcw, Send } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  handoffHref,
  handoffLabel,
  type Handoff,
  type PreviewMessage,
  sendPreviewMessage,
  uniqueSources,
} from "@/lib/preview-chat";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * "Test chat" (M3-13): talks to the saved draft over the workspace's
 * knowledge. Each bot reply can show the sources it was built from
 * (M3-14). The answer streams in; the server keeps the conversation.
 */
export function PreviewChat({
  welcomeMessage,
  className,
}: {
  welcomeMessage: string;
  /** Sizing from the page, e.g. filling the Chatbot page. */
  className?: string;
}) {
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [openSources, setOpenSources] = useState<number | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, sending]);

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    const earlier = messages;
    setMessages([...earlier, { role: "user", text: message }]);
    setInput("");
    setSending(true);
    // The answer's bubble appears with its first piece and grows from there.
    let started = false;
    let sources: PreviewChatSource[] = [];
    let handoff: Handoff | undefined;
    let leadForm = false;
    const showAnswer = (text: string) => {
      const replace = started;
      setMessages((current) => {
        const answer: PreviewMessage = {
          role: "assistant",
          text,
          sources,
          handoff,
          leadForm,
        };
        return replace ? [...current.slice(0, -1), answer] : [...current, answer];
      });
    };
    try {
      let text = "";
      await sendPreviewMessage(message, conversationId, (event) => {
        if (event.type === "sources") {
          sources = event.sources;
          if (started) showAnswer(text);
        } else if (event.type === "delta") {
          text += event.text;
          showAnswer(text);
          started = true;
        } else if (event.type === "lead_form") {
          leadForm = true;
          if (started) showAnswer(text);
        } else if (event.type === "handoff") {
          handoff = event;
          showAnswer(text);
        } else if (event.type === "follow_up") {
          // A second bot message right after the answer (it gave contact details).
          setMessages((current) => [
            ...current,
            { role: "assistant", text: event.text },
          ]);
        } else if (event.type === "done") {
          setConversationId(event.conversationId);
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      });
    } catch (err) {
      toastError((err as Error).message);
      // Nothing of a broken answer is stored, so none of it stays on screen.
      setMessages(earlier);
      setInput(message);
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      className={cn("flex h-[32rem] flex-col rounded-xl border bg-card", className)}
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold">Test chat</h3>
          <p className="text-xs text-muted-foreground">
            Uses the saved draft and your knowledge base.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Restart the test chat"
          disabled={sending || messages.length === 0}
          onClick={() => {
            setMessages([]);
            setOpenSources(null);
            setConversationId(null);
          }}
        >
          <RotateCcw />
        </Button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <Bubble role="assistant">{welcomeMessage}</Bubble>
        {messages.map((m, i) => {
          const sources = uniqueSources(m.sources ?? []);
          return (
            <div key={i} className="space-y-1">
              <Bubble role={m.role}>{m.text}</Bubble>
              {m.leadForm && (
                <p className="ml-1 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  A short contact form (name, email or phone, what they need)
                  appears here for your visitors. Nothing is saved from this
                  Test chat.
                </p>
              )}
              {m.handoff && (
                <a
                  href={handoffHref(m.handoff)}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 inline-block rounded-full border px-3 py-1 text-xs hover:bg-muted"
                >
                  {handoffLabel(m.handoff)}
                </a>
              )}
              {m.role === "assistant" && (
                <div className="pl-1 text-xs text-muted-foreground">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() => setOpenSources(openSources === i ? null : i)}
                  >
                    <Info className="size-3" />
                    {sources.length
                      ? `${sources.length} source${sources.length > 1 ? "s" : ""}`
                      : "No sources matched"}
                  </button>
                  {openSources === i && sources.length > 0 && (
                    <ul className="mt-1 list-disc pl-5">
                      {sources.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {sending && messages.at(-1)?.role === "user" && (
          <Bubble role="assistant">
            <span className="text-muted-foreground">Thinking…</span>
          </Bubble>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t p-3">
        <Textarea
          value={input}
          rows={1}
          placeholder="Ask something about your business…"
          className="max-h-32 min-h-9 resize-none"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <Button
          type="submit"
          size="icon"
          aria-label="Send"
          disabled={sending || !input.trim()}
        >
          <Send />
        </Button>
      </form>
    </section>
  );
}

function Bubble({
  role,
  children,
}: {
  role: PreviewMessage["role"];
  children: React.ReactNode;
}) {
  // An answer is Markdown (bold prices, short lists); what the visitor typed is not.
  const markdown = role === "assistant" && typeof children === "string";
  return (
    <div
      className={cn(
        "w-fit max-w-[85%] rounded-2xl px-3 py-2",
        !markdown && "whitespace-pre-wrap",
        role === "user"
          ? "ml-auto bg-primary text-primary-foreground"
          : "bg-muted",
      )}
    >
      {markdown ? <ChatMarkdown>{children}</ChatMarkdown> : children}
    </div>
  );
}
