import type { ComponentChildren } from "preact";
import type { Brand } from "../theme";
import type { ChatMessage } from "../types";

/**
 * One message. The visitor's own bubbles sit on the right in the brand
 * color; the assistant's sit on the left in grey. `children` is plain
 * text today; the sanitized Markdown view (M4-5) goes in its place.
 */
export function MessageBubble({
  role,
  brand,
  children,
}: {
  role: ChatMessage["role"];
  brand: Brand;
  children: ComponentChildren;
}) {
  const mine = role === "user";
  return (
    <div
      data-role={role}
      class={`w-fit max-w-[85%] rounded-2xl px-3 py-2 break-words whitespace-pre-wrap ${
        mine ? "ml-auto" : "bg-zinc-100"
      }`}
      style={mine ? { ...brand } : undefined}
    >
      {children}
    </div>
  );
}
