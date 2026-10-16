import type { ComponentChildren } from "preact";
import type { Brand } from "../theme";
import type { ChatMessage } from "../types";

/**
 * One message. The visitor's own bubbles sit on the right in the brand
 * color; the assistant's sit on the left in grey. `children` is the
 * visitor's plain text or the assistant's sanitized Markdown (M4-5).
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
      class={`w-fit max-w-[85%] rounded-2xl px-3 py-2 break-words ${
        mine ? "ml-auto whitespace-pre-wrap" : "bg-zinc-100"
      }`}
      style={mine ? { ...brand } : undefined}
    >
      {children}
    </div>
  );
}
