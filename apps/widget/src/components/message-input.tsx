import type { Ref } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { STRINGS } from "../strings";
import type { Brand } from "../theme";
import { MESSAGE_MAX_CHARS } from "../types";
import { SendIcon } from "./icons";

/** The box grows with the text up to this height, then scrolls. */
export const INPUT_MAX_HEIGHT_PX = 160;

/**
 * The text box and send button. Enter sends, Shift+Enter starts a new
 * line. Blank messages, and messages while `disabled` (an answer is
 * still coming), are not sent. The box itself stays usable while an
 * answer streams, so keyboard focus is never thrown out of it (M4-7).
 */
export function MessageInput({
  onSend,
  disabled = false,
  brand,
  inputRef,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
  brand: Brand;
  /** Lets the window move focus into the box (on open, after a chip). */
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement | null>(null);
  const canSend = !disabled && text.trim().length > 0;

  // Grow with the text so earlier lines never scroll out of sight; shrink
  // back after sending.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT_PX)}px`;
  }, [text]);

  function setBox(el: HTMLTextAreaElement | null) {
    box.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef)
      (inputRef as { current: HTMLTextAreaElement | null }).current = el;
  }

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <form
      class="flex items-end gap-2 border-t border-zinc-200 p-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={setBox}
        value={text}
        rows={1}
        maxLength={MESSAGE_MAX_CHARS}
        aria-label={STRINGS.inputLabel}
        placeholder={STRINGS.inputPlaceholder}
        class="max-h-40 min-h-9 flex-1 resize-none overflow-y-auto rounded-lg border border-zinc-300 px-3 py-2 text-base focus:border-zinc-500 sm:text-sm"
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
