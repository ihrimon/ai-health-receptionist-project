import { useState } from "preact/hooks";
import { STRINGS } from "../strings";
import { StarIcon } from "./icons";

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * "How was this conversation?" with 1–5 stars (FR-4.6). It only reports
 * the choice; the caller sends it (`POST /v1/public/conversations/:id/rating`,
 * M5-7). After a choice it says thanks, and the choice is final.
 */
export function RatingPrompt({
  onRate,
  onDismiss,
}: {
  onRate: (stars: number) => void;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(0);
  const [rated, setRated] = useState(false);

  if (rated) {
    return (
      <p role="status" class="rounded-xl border border-zinc-200 p-3 text-center text-sm text-zinc-600">
        {STRINGS.ratingThanks}
      </p>
    );
  }

  return (
    <section
      aria-label={STRINGS.ratingQuestion}
      class="rounded-xl border border-zinc-200 p-3 text-center"
    >
      <p class="text-sm font-medium">{STRINGS.ratingQuestion}</p>
      <div class="mt-2 flex justify-center gap-1" onMouseLeave={() => setHovered(0)}>
        {STARS.map((star) => {
          const lit = star <= hovered;
          return (
            <button
              key={star}
              type="button"
              aria-label={STRINGS.rateStars(star)}
              data-lit={lit}
              class={`rounded p-0.5 ${lit ? "text-amber-400" : "text-zinc-300"}`}
              onMouseEnter={() => setHovered(star)}
              onFocus={() => setHovered(star)}
              onBlur={() => setHovered(0)}
              onClick={() => {
                setRated(true);
                onRate(star);
              }}
            >
              <StarIcon filled={lit} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        class="mt-2 text-xs text-zinc-500 hover:text-zinc-700"
        onClick={onDismiss}
      >
        {STRINGS.ratingSkip}
      </button>
    </section>
  );
}
