import { STRINGS } from "../strings";
import type { Brand } from "../theme";

/**
 * The company's suggested questions (`widget.quickReplies`) as chips under
 * the welcome message. A click sends the chip's text as the visitor's message.
 */
export function QuickReplies({
  replies,
  brand,
  onPick,
}: {
  replies: string[];
  brand: Brand;
  onPick: (text: string) => void;
}) {
  if (!replies.length) return null;
  return (
    <div role="group" aria-label={STRINGS.quickReplies} class="flex flex-wrap gap-2">
      {replies.map((reply) => (
        <button
          key={reply}
          type="button"
          class="rounded-full border px-3 py-1 text-sm hover:opacity-80"
          style={{ borderColor: brand.background }}
          onClick={() => onPick(reply)}
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
