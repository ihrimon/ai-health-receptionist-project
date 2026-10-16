import { render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { STRINGS } from "../strings";
import { RatingPrompt } from "./rating-prompt";

function setup() {
  const onRate = vi.fn();
  const onDismiss = vi.fn();
  render(<RatingPrompt onRate={onRate} onDismiss={onDismiss} />);
  return { onRate, onDismiss, user: userEvent.setup() };
}

const star = (n: number) => screen.getByRole("button", { name: STRINGS.rateStars(n) });

describe("RatingPrompt", () => {
  it("offers five stars", () => {
    setup();
    expect(screen.getByText(STRINGS.ratingQuestion)).toBeTruthy();
    for (const n of [1, 2, 3, 4, 5]) expect(star(n)).toBeTruthy();
    expect(STRINGS.rateStars(1)).toBe("Rate 1 star");
  });

  it("lights the stars up to the one under the pointer", async () => {
    const { user } = setup();
    await user.hover(star(3));
    expect([1, 2, 3, 4, 5].map((n) => star(n).dataset.lit)).toEqual([
      "true",
      "true",
      "true",
      "false",
      "false",
    ]);
    await user.unhover(star(3));
    expect(star(1).dataset.lit).toBe("false");
  });

  it("reports the chosen stars once and says thanks", async () => {
    const { onRate, user } = setup();
    await user.click(star(4));
    expect(onRate).toHaveBeenCalledTimes(1);
    expect(onRate).toHaveBeenCalledWith(4);
    expect(screen.getByRole("status").textContent).toBe(STRINGS.ratingThanks);
    expect(screen.queryByRole("button", { name: STRINGS.rateStars(4) })).toBeNull();
  });

  it("can be chosen with the keyboard", async () => {
    const { onRate, user } = setup();
    await user.tab();
    await user.tab();
    expect(star(2).dataset.lit).toBe("true");
    await user.keyboard("{Enter}");
    expect(onRate).toHaveBeenCalledWith(2);
  });

  it("can be skipped", async () => {
    const { onRate, onDismiss, user } = setup();
    await user.click(screen.getByRole("button", { name: STRINGS.ratingSkip }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onRate).not.toHaveBeenCalled();
  });
});
