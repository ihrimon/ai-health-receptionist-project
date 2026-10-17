import type { PublicChatConfig } from "@brainstack/shared";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { widgetApi } from "./api";
import { ChatWindow } from "./components/chat-window";
import { QuickReplies } from "./components/quick-replies";
import { RatingPrompt } from "./components/rating-prompt";
import type { HostWindow } from "./host";
import { STRINGS } from "./strings";
import { brandFor, textOn } from "./theme";
import { useChat } from "./use-chat";
import { type Host, useHost } from "./use-host";

/** How long the chat stays quiet after an answer before the rating is asked (D-3: "after a while of silence"). */
export const RATING_IDLE_MS = 30_000;

type Load =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; config: PublicChatConfig };

/**
 * The widget page: loads the chatbot's published config (M4-4) and then
 * the chat. An unknown, unpublished or switched-off chatbot (404), or an
 * API that can't be reached, shows a short "not available" note.
 *
 * In the loader's iframe it also talks to the host page (M4-10): it sends
 * the launcher's color and side, closes the panel (close button, Escape)
 * and reports answers that arrived while the panel was closed.
 */
export function App({
  publicId,
  hostWindow = window,
  ratingIdleMs = RATING_IDLE_MS,
}: {
  publicId: string | null;
  hostWindow?: HostWindow;
  /** Quiet time before the rating prompt; shorter in tests. */
  ratingIdleMs?: number;
}) {
  const [load, setLoad] = useState<Load>(publicId ? { kind: "loading" } : { kind: "unavailable" });
  const host = useHost(hostWindow);

  useEffect(() => {
    if (!publicId) return;
    let cancelled = false;
    widgetApi.config(publicId).then(
      (config) => {
        if (cancelled) return;
        document.title = config.botName;
        setLoad({ kind: "ready", config });
      },
      () => !cancelled && setLoad({ kind: "unavailable" }),
    );
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  // Only the launcher's look goes to the host page: nothing private.
  useEffect(() => {
    if (load.kind !== "ready") return;
    const { primaryColor, position, launcherIcon } = load.config;
    host.connection?.post({ type: "config", primaryColor, textColor: textOn(primaryColor), position, launcherIcon });
  }, [load, host.connection]);

  if (load.kind !== "ready" || !publicId) {
    return (
      <div
        role="status"
        class="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-zinc-500"
      >
        {load.kind === "loading" ? STRINGS.loading : STRINGS.unavailable}
      </div>
    );
  }
  return <Chat publicId={publicId} config={load.config} host={host} ratingIdleMs={ratingIdleMs} />;
}

/**
 * The chat with the published look: header title, welcome message, brand
 * color and the branding line, and the quick-reply chips under the welcome
 * until the visitor's first message (M4-6). The launcher's color and side
 * belong to the loader. Once the bot has answered and the chat goes quiet,
 * or the visitor closes the panel, it asks for a 1–5 star rating (M5-7).
 */
function Chat({
  publicId,
  config,
  host,
  ratingIdleMs,
}: {
  publicId: string;
  config: PublicChatConfig;
  host: Host;
  ratingIdleMs: number;
}) {
  const chat = useChat(publicId);
  const brand = brandFor(config.primaryColor);
  const rating = useRatingPrompt(chat, host, ratingIdleMs);
  const send = (text: string) => {
    rating.onSend();
    void chat.send(text);
  };
  useUnread(host, chat.busy || chat.waiting);
  const { connection, embedded } = host;
  // Stable between renders, so the window's Escape listener isn't re-added on every streamed word.
  const onClose = useMemo(
    () => (embedded && connection ? () => connection.post({ type: "close" }) : undefined),
    [embedded, connection],
  );
  return (
    <ChatWindow
      title={config.headerTitle}
      welcomeMessage={config.welcomeMessage}
      messages={chat.messages}
      typing={chat.waiting}
      busy={chat.busy}
      brand={brand}
      showBranding={config.showBranding}
      onSend={send}
      onClose={onClose}
      focusSignal={host.opened}
    >
      {!chat.messages.length && !chat.busy && (
        <QuickReplies replies={config.quickReplies} brand={brand} onPick={send} />
      )}
      {rating.show && <RatingPrompt onRate={rating.onRate} onDismiss={rating.onDismiss} />}
    </ChatWindow>
  );
}

/**
 * When to ask for the rating (FR-4.6, D-3 §widget): after a complete
 * answer, once the chat has been quiet for `idleMs` or the panel was closed
 * (so it waits there when the visitor comes back). Asked once per
 * conversation: a rated one (remembered across reloads) isn't asked
 * again, and "Skip for now" hides it until the next page load. While an
 * answer is coming the prompt steps aside; the thanks goes away with the
 * visitor's next message.
 */
function useRatingPrompt(chat: ReturnType<typeof useChat>, host: Host, idleMs: number) {
  const [asked, setAsked] = useState(false);
  const [thanked, setThanked] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const waiting = chat.answered && !chat.rated && !chat.busy && !dismissed && !asked;
  const closed = host.embedded && !host.open;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setAsked(true), closed ? 0 : idleMs);
    return () => clearTimeout(timer);
  }, [waiting, closed, idleMs]);

  return {
    show: !chat.busy && !dismissed && (thanked || (asked && !chat.rated)),
    onRate: (stars: number) => {
      setThanked(true);
      void chat.rate(stars);
    },
    onDismiss: () => setDismissed(true),
    onSend: () => {
      if (thanked) setDismissed(true);
    },
  };
}

/**
 * Counts the answers that finish (`pending` goes from true to false) while
 * the panel is closed, for the launcher's badge; opening the panel clears it.
 */
function useUnread(host: Host, pending: boolean) {
  const [unread, setUnread] = useState(0);
  const wasPending = useRef(pending);
  const closed = host.embedded && !host.open;

  useEffect(() => {
    const finished = wasPending.current && !pending;
    wasPending.current = pending;
    if (finished && closed) setUnread((n) => n + 1);
  }, [pending, closed]);

  useEffect(() => {
    if (!closed) setUnread(0);
  }, [closed]);

  const sent = useRef(0);
  useEffect(() => {
    if (unread === sent.current) return;
    sent.current = unread;
    host.connection?.post({ type: "unread", count: unread });
  }, [unread, host.connection]);
}
