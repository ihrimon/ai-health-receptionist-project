import { useState } from "preact/hooks";
import { STRINGS } from "../strings";
import type { Brand } from "../theme";
import { MESSAGE_MAX_CHARS } from "../types";
import { SendIcon } from "./icons";

/**
 * The text box and send button. Enter sends, Shift+Enter starts a new
 * line. Blank messages, and messages while `disabled` (an answer is
 * still coming), are not sent.
 */
export function MessageInput({
  onSend,
  disabled = false,
  brand,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  brand: Brand;
}) {
  const [text, setText] = useState("");
  const canSend = !disabled && text.trim().length > 0;

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <form
      class="flex items-end gap-2 border-t border-zinc-200 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={text}
        rows={1}
        maxLength={MESSAGE_MAX_CHARS}
        aria-label={STRINGS.inputLabel}
        placeholder={STRINGS.inputPlaceholder}
        class="max-h-28 min-h-9 flex-1 resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500"
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="submit"
        aria-label={STRINGS.send}
        disabled={!canSend}
        class="flex size-9 shrink-0 items-center justify-center rounded-lg disabled:opacity-50"
        style={{ ...brand }}
      >
        <SendIcon />
      </button>
    </form>
  );
}
