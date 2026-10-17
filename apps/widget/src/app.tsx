import type { PublicChatConfig } from "@brainstack/shared";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { widgetApi } from "./api";
import { ChatWindow } from "./components/chat-window";
import { QuickReplies } from "./components/quick-replies";
import type { HostWindow } from "./host";
import { STRINGS } from "./strings";
import { brandFor, textOn } from "./theme";
import { useChat } from "./use-chat";
import { type Host, useHost } from "./use-host";

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
}: {
  publicId: string | null;
  hostWindow?: HostWindow;
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
  return <Chat publicId={publicId} config={load.config} host={host} />;
}

/**
 * The chat with the published look: header title, welcome message, brand
 * color and the branding line, and the quick-reply chips under the welcome
 * until the visitor's first message (M4-6). The launcher's color and side
 * belong to the loader.
 */
function Chat({ publicId, config, host }: { publicId: string; config: PublicChatConfig; host: Host }) {
  const chat = useChat(publicId);
  const brand = brandFor(config.primaryColor);
  const send = (text: string) => void chat.send(text);
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
    </ChatWindow>
  );
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
