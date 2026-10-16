import { useState } from "preact/hooks";
import { ChatWindow } from "./components/chat-window";
import { brandFor, DEFAULT_PRIMARY_COLOR } from "./theme";
import type { ChatMessage } from "./types";

let lastId = 0;
const newId = () => `m${++lastId}`;

/**
 * The widget page. For now it only shows the visitor's own messages:
 * the published config (M4-4) replaces the defaults below, and the
 * streaming client (M4-3) adds the answer in `send`.
 */
export function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const brand = brandFor(DEFAULT_PRIMARY_COLOR);

  function send(text: string) {
    setMessages((current) => [...current, { id: newId(), role: "user", text }]);
  }

  return (
    <ChatWindow
      title="Chat"
      welcomeMessage="Hi! How can I help you today?"
      messages={messages}
      typing={false}
      brand={brand}
      onSend={send}
    />
  );
}
