import { STRINGS } from "../strings";

/** Three bouncing dots while the answer's first word hasn't arrived. */
export function TypingIndicator() {
  return (
    <div
      role="status"
      aria-label={STRINGS.typing}
      class="flex w-fit items-center gap-1 rounded-2xl bg-zinc-100 px-3 py-3"
    >
      <span class="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
      <span class="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
      <span class="size-1.5 animate-bounce rounded-full bg-zinc-400" />
    </div>
  );
}
