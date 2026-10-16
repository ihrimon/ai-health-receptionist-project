import type { PublicChatConfig } from "@brainstack/shared";
import { useEffect, useState } from "preact/hooks";
import { widgetApi } from "./api";
import { ChatWindow } from "./components/chat-window";
import { QuickReplies } from "./components/quick-replies";
import { STRINGS } from "./strings";
import { brandFor } from "./theme";
import { useChat } from "./use-chat";

type Load =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; config: PublicChatConfig };

/**
 * The widget page: loads the chatbot's published config (M4-4) and then
 * the chat. An unknown, unpublished or switched-off chatbot (404), or an
 * API that can't be reached, shows a short "not available" note.
 */
export function App({ publicId }: { publicId: string | null }) {
  const [load, setLoad] = useState<Load>(publicId ? { kind: "loading" } : { kind: "unavailable" });

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

  if (load.kind !== "ready" || !publicId) {
    return (
      <div class="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-zinc-500">
        {load.kind === "loading" ? STRINGS.loading : STRINGS.unavailable}
      </div>
    );
  }
  return <Chat publicId={publicId} config={load.config} />;
}

/**
 * The chat with the published look: header title, welcome message, brand
 * color and the branding line, and the quick-reply chips under the welcome
 * until the visitor's first message (M4-6). The launcher's color and side
 * belong to the loader.
 */
function Chat({ publicId, config }: { publicId: string; config: PublicChatConfig }) {
  const chat = useChat(publicId);
  const brand = brandFor(config.primaryColor);
  const send = (text: string) => void chat.send(text);
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
    >
      {!chat.messages.length && !chat.busy && (
        <QuickReplies replies={config.quickReplies} brand={brand} onPick={send} />
      )}
    </ChatWindow>
  );
}
